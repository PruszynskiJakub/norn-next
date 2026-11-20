/**
 * The loop end to end on real git: a local tracker item goes through the shipped quick workflow, the
 * real tracker, forge, store and vcs plugins doing every effect and a scripted agent the agent's part.
 */
import { describe, expect, test } from "bun:test";
import { DEFAULT_COUNTER_DEFAULTS } from "@norn/kernel";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { recordPath } from "@norn/forge-none";
import { PR_BODY_FILE } from "@norn/schema";
import { checkExitsDir, checkLogsDir, runEventsDir, sessionLogPath, specFolder, TRACE_DIR, unitEventsDir } from "../../src/index.ts";
import { type AgentScript, commit, decideGate, git, type Machine, machine, personMerges, rulesOf, type Team, team, tickUntil, unitRecord } from "./world.ts";

const quickAgent: AgentScript = (step, visit, run) => {
  switch (step) {
    case "implement":
      return { commit: { "feature.txt": `feature, take ${visit + 1}\n` }, outcome: "done" };
    case "review":
      return { outcome: "approve" };
    case "describe":
      return { commit: { [`${specFolder(run.unit)}/${PR_BODY_FILE}`]: "# Add the feature\n\nfeature.txt holds the feature.\n" }, outcome: "done" };
    default:
      throw new Error(`the quick agent has no script for ${step}`);
  }
};

describe("a local tracker item through the quick workflow", () => {
  test("intake, sync, implement, update, test, review, describe, open-pr, ci, ready, merge, done", async () => {
    const t = await team();
    const m = await machine(t, { name: "a", script: quickAgent });
    const made = await m.env.slots.tracker.perform({ kind: "create", title: "Add the feature", body: "Add it.", labels: ["norn"], assignee: "me" }, { receipt_id: "create-1" });
    expect(made.ok).toBe(true);
    const unit = "lt-1";

    const parked = async () => (await unitRecord(m, unit)).state?.parked !== undefined;
    const toReady = await tickUntil(m, parked);
    const state = (await unitRecord(m, unit)).state;
    expect([state?.step, state?.parked?.reason]).toEqual(["ready", "gate.park"]);
    const rules = toReady.flatMap(rulesOf);
    expect(rules.filter((r) => r.includes("!"))).toEqual([]);
    // every agent step ran once, in the workflow's order
    expect(m.agents.starts.map((s) => s.step)).toEqual(["implement", "review", "describe"]);

    // the story branch is on the remote and a change is open on the none forge, with pr.md as its body
    const worktree = m.agents.starts[0]?.worktree as string;
    expect(worktree.startsWith(join(t.dir, "a-machine", "worktrees"))).toBe(true);
    const head = await git(worktree, "rev-parse", "HEAD");
    expect(await git(m.repo, "ls-remote", "origin", `refs/heads/norn/${unit}`)).toStartWith(head);
    const changes = await m.env.slots.forge.findChanges([`norn/${unit}`]);
    const change = changes.ok ? changes.value[`norn/${unit}`] : null;
    expect([change?.state, change?.head_sha, change?.title]).toEqual(["open", head, "Add the feature"]);
    const body = change ? await m.ctx.files.read(recordPath(m.ctx, change.id)) : null;
    expect(body).toContain("feature.txt holds the feature.");

    await decideGate(m, unit, "approve");
    await tickUntil(m, async () => (await unitRecord(m, unit)).state?.step === "merge");
    // waiting at merge: nothing more happens until a person merges
    await tickUntil(m, () => true, 2);
    expect((await unitRecord(m, unit)).state?.ended).toBeUndefined();

    // the logs a real run leaves, for each run the record started: hook events, launch record, session log
    const runs = (await unitRecord(m, unit)).receipts.flatMap((r) => (r.data.kind === "run.started" ? [r.data.run_id] : []));
    for (const run of runs) {
      await m.ctx.files.write(`${runEventsDir(m.ctx, unit, run)}/events/000000000001.json`, "[]\n");
      await m.ctx.files.write(`${runEventsDir(m.ctx, unit, run)}/launch.json`, "{}\n");
      await m.ctx.files.write(sessionLogPath(m.ctx, run), "agent output\n");
    }
    const filesUnder = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name) : []);
    expect(filesUnder(checkLogsDir(m.ctx, unit)).length).toBeGreaterThan(0);

    await personMerges(m, unit);
    await tickUntil(m, async () => (await unitRecord(m, unit)).state?.ended === "done");
    await tickUntil(m, async () => {
      const claim = await m.env.slots.store.claims.read(unit);
      return claim.ok && claim.value === null;
    });
    expect(existsSync(join(m.repo, "feature.txt"))).toBe(true);
    expect(m.agents.starts.map((s) => s.step)).toEqual(["implement", "review", "describe"]);
    // the done story is tidied before its claim goes: its worktree removed, its item closed
    expect(existsSync(worktree)).toBe(false);
    const item = await m.env.slots.tracker.get(1);
    expect(item.ok && item.value?.open).toBe(false);
    // and its logs gone with it: hook events, session logs, check logs and exits
    expect(filesUnder(unitEventsDir(m.ctx, unit))).toEqual([]);
    expect(runs.filter((run) => existsSync(sessionLogPath(m.ctx, run)))).toEqual([]);
    expect([...filesUnder(checkLogsDir(m.ctx, unit)), ...filesUnder(checkExitsDir(m.ctx, unit))]).toEqual([]);
    // every tick left its trace
    expect(readdirSync(join(t.dir, "a-machine", TRACE_DIR)).length).toBeGreaterThan(10);
  }, 60_000);
});

describe("a check that keeps failing", () => {
  test("sends the story back to implement each time, and the counter ends it stuck", async () => {
    const t = await team();
    // every take of implement breaks the build
    const breaking: AgentScript = (step, visit, run) =>
      step === "implement" ? { commit: { broken: `take ${visit + 1}\n` }, outcome: "done" } : quickAgent(step, visit, run);
    const m = await machine(t, { name: "a", script: breaking, kernel: { counterDefaults: { ...DEFAULT_COUNTER_DEFAULTS, checkFail: 2 } } });
    await m.env.slots.tracker.perform({ kind: "create", title: "Break it", body: "", labels: ["norn"], assignee: "me" }, { receipt_id: "create-1" });
    const unit = "lt-1";
    const reports = await tickUntil(m, async () => (await unitRecord(m, unit)).state?.ended !== undefined, 60);
    const state = (await unitRecord(m, unit)).state;
    expect([state?.ended, state?.step]).toEqual(["stuck", "test"]);
    expect(state?.ended_reason).toContain("test");
    // the first failure and the one the counter allows go back to implement; the third ends it
    expect(m.agents.starts.map((s) => s.step)).toEqual(["implement", "implement", "implement"]);
    // each check runs detached: the tick that starts it returns at once, and a later tick routes its outcome
    const checks = reports.flatMap((r) => r.outcomes).filter((o) => o.decision.rule === "check.run");
    expect(checks.map((o) => (o.ok ? (o.detail as { running?: boolean }).running : o.error))).toEqual([true, true, true]);
    const finished = (await unitRecord(m, unit)).receipts.flatMap((r) => (r.data.kind === "check.finished" ? [r.data.outcome] : []));
    expect(finished).toEqual(["fail", "fail", "fail"]);
    expect(reports.flatMap(rulesOf).filter((r) => r.includes("!"))).toEqual([]);
    await tickUntil(m, async () => {
      const claim = await m.env.slots.store.claims.read(unit);
      return claim.ok && claim.value === null;
    });
    // a stuck story keeps its worktree for the person and its item open
    expect(existsSync(m.agents.starts[0]?.worktree as string)).toBe(true);
    const item = await m.env.slots.tracker.get(1);
    expect(item.ok && item.value?.open).toBe(true);
  }, 60_000);
});

/** A story through quick to `merge`, approved at ready, waiting for a person to merge it. */
async function atMerge(t: Team): Promise<{ m: Machine; unit: string }> {
  const m = await machine(t, { name: "a", script: quickAgent });
  await m.env.slots.tracker.perform({ kind: "create", title: "Add the feature", body: "Add it.", labels: ["norn"], assignee: "me" }, { receipt_id: "create-1" });
  const unit = "lt-1";
  await tickUntil(m, async () => (await unitRecord(m, unit)).state?.parked !== undefined);
  await decideGate(m, unit, "approve");
  await tickUntil(m, async () => (await unitRecord(m, unit)).state?.step === "merge");
  return { m, unit };
}

/** A person pushes one commit to main from their own clone. */
async function baseMoves(t: Team, name: string, files: Record<string, string>): Promise<string> {
  const p = await t.clone(name);
  const sha = await commit(p, "base moves", files);
  await git(p, "push", "-q", "origin", "main");
  return sha;
}

describe("a base that moves under a story waiting at merge", () => {
  test("an unrelated clean move is verified once and leaves the story waiting; a clean move that breaks the merged tree sends it back through update", async () => {
    const t = await team();
    const { m, unit } = await atMerge(t);
    await baseMoves(t, "person-1", { "unrelated.txt": "someone else's work\n" });
    const quiet = await tickUntil(m, () => true, 3);
    expect((await unitRecord(m, unit)).state?.step).toBe("merge");
    expect(quiet.flatMap(rulesOf).filter((r) => r.includes("signal") || r.includes("!"))).toEqual([]);
    expect(quiet.flatMap((r) => r.problems)).toEqual([]);
    // the merged tree was tested, once for this base move
    expect(await m.ctx.files.read(`${m.ctx.repo.dataDir}/verify-base/${unit}.json`)).toContain('"outcome":"verified"');

    await baseMoves(t, "person-2", { broken: "the base broke what the story relies on\n" });
    const back = await tickUntil(m, async () => (await unitRecord(m, unit)).state?.step !== "merge", 3);
    expect(back.flatMap(rulesOf)).toContain(`${unit} step.signal`);
    expect(m.agents.starts.map((s) => s.step)).toEqual(["implement", "review", "describe"]);
  }, 60_000);

  test("a person closing the change at merge parks the story for them, and no new change is opened", async () => {
    const t = await team();
    const { m, unit } = await atMerge(t);
    const found = await m.env.slots.forge.findChanges([`norn/${unit}`]);
    const change = found.ok ? found.value[`norn/${unit}`] : undefined;
    if (!change) throw new Error("no change opened");
    const path = recordPath(m.ctx, change.id);
    const rec = JSON.parse((await m.ctx.files.read(path)) as string);
    await m.ctx.files.write(path, `${JSON.stringify({ ...rec, closed_at: "2026-11-17T09:30:00.000Z" })}\n`);
    await baseMoves(t, "person-1", { "unrelated.txt": "x\n" });
    const reports = await tickUntil(m, async () => (await unitRecord(m, unit)).state?.parked !== undefined, 3);
    expect(reports.flatMap(rulesOf)).toContain(`${unit} story.change_closed`);
    const state = (await unitRecord(m, unit)).state;
    expect([state?.step, state?.parked?.reason]).toEqual(["merge", expect.stringContaining("closed without merging")]);
    await tickUntil(m, () => true, 2);
    expect((await unitRecord(m, unit)).state?.step).toBe("merge");
    const after = await m.env.slots.forge.findChanges([`norn/${unit}`]);
    expect(after.ok && after.value[`norn/${unit}`]?.id).toBe(change.id);
  }, 60_000);
});
