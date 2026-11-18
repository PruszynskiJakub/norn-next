import { describe, expect, test } from "bun:test";
import { claudeHarness } from "@norn/harness-claude";
import { markPrompt, RUN_ENV } from "@norn/plugin-api";
import {
  batchesDir,
  batchName,
  briefOf,
  EventLogSessionSource,
  ingestHook,
  type IngestDeps,
  MAX_STOP_BLOCKS,
  queueInjection,
  readEvents,
  recordSentPrompt,
  reportRun,
} from "../../src/index.ts";
import { has, harness, type Harnessed, record, session, tickUntil, trackerItem } from "./support.ts";

const UNIT = "lt-1";
const WORKTREE = "/machine/repo/worktrees/lt-1";

/** A story at its agent step with the run started and on the record. */
async function running(): Promise<{ h: Harnessed; runId: string }> {
  const h = harness({ workflow: "agented" });
  h.items.push(trackerItem(1));
  await tickUntil(h, has("agent.start"));
  await tickUntil(h, has("receipts.apply"));
  const runId = (await record(h, UNIT)).state?.run?.id;
  if (!runId) throw new Error("no run started");
  return { h, runId };
}

function deps(h: Harnessed, over: Partial<IngestDeps> = {}): IngestDeps {
  return { ctx: h.ctx, harnesses: { claude: claudeHarness }, journal: h.env.journal, worktreeOf: () => WORKTREE, writableRoots: ["/tmp"], ...over };
}

const env = (runId: string) => ({ [RUN_ENV.unit]: UNIT, [RUN_ENV.run]: runId });

async function hook(h: Harnessed, runId: string, name: string, payload: Record<string, unknown>, over: Partial<IngestDeps> = {}) {
  const r = await ingestHook(deps(h, over), { harness: "claude", hook: name, payload: { hook_event_name: name, session_id: "s1", ...payload }, env: env(runId) });
  await r.delivered();
  return r;
}

const preWrite = (path: string) => ({ tool_use_id: `t-${path}`, tool_name: "Write", tool_input: { file_path: path, content: "x" } });

describe("stop hook", () => {
  test("a turn ending before the run reports is blocked with how to report; after the report it is allowed", async () => {
    const { h, runId } = await running();
    const blocked = await hook(h, runId, "Stop", {});
    const out = JSON.parse(blocked.reply.stdout);
    expect(out.decision).toBe("block");
    expect(out.reason).toContain("norn done <done>");
    expect(out.reason).toContain("norn ask");
    expect(out.reason).toContain("norn stuck");
    expect(blocked.problems).toEqual([]);

    const reported = await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done", text: "built" }, "r1");
    expect(reported.ok).toBe(true);
    const allowed = await hook(h, runId, "Stop", {});
    expect(allowed.reply).toEqual({ stdout: "", exit_code: 0 });
  });

  test("a run that never reports is blocked at most MAX_STOP_BLOCKS times; the next turn end is allowed and reads as ended", async () => {
    const { h, runId } = await running();
    for (let i = 0; i < MAX_STOP_BLOCKS; i++) expect(JSON.parse((await hook(h, runId, "Stop", { stop_hook_active: i > 0 })).reply.stdout).decision).toBe("block");
    const past = await hook(h, runId, "Stop", { stop_hook_active: true });
    expect(past.reply).toEqual({ stdout: "", exit_code: 0 });
    expect(past.problems).toEqual([]);
    expect((await hook(h, runId, "Stop", {})).reply).toEqual({ stdout: "", exit_code: 0 });
    // the allowed turn end reaches the session facts, so decide's nudges and retries take over
    const facts = await new EventLogSessionSource({ ctx: h.ctx, classify: { silentAfterMs: 60_000 } }).facts(UNIT, runId);
    expect(facts?.activity).toBe("turn_ended");
  });

  test("past the cap a queued nudge still rides on a stop block, once, without the report demand", async () => {
    const { h, runId } = await running();
    for (let i = 0; i < MAX_STOP_BLOCKS; i++) await hook(h, runId, "Stop", {});
    await queueInjection(h.ctx, UNIT, runId, { id: "n1", source: "nudge", text: "norn: carry on", at: h.ctx.now() });
    const carried = JSON.parse((await hook(h, runId, "Stop", {})).reply.stdout);
    expect([carried.decision, carried.reason]).toEqual(["block", "norn: carry on"]);
    expect((await hook(h, runId, "Stop", {})).reply.stdout).toBe("");
  });

  test("a report whose receipt the kernel rejected does not let the turn end unreported", async () => {
    const { h, runId } = await running();
    const reported = await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1");
    if (!reported.ok) throw new Error(reported.refusal.error);
    expect((await hook(h, runId, "Stop", {})).reply.stdout).toBe("");
    // the report.made event stays in the log; the record says the report does not stand
    await h.env.journal.record(UNIT, { id: "reject-r1", data: { kind: "receipt.rejected", seq: reported.value.seq, reason: "test: refused" } });
    expect(JSON.parse((await hook(h, runId, "Stop", {})).reply.stdout).decision).toBe("block");
  });

  test("a hook from a run that is no longer live is never held to a report", async () => {
    const { h } = await running();
    const r = await hook(h, "01JOLDRUN00000000000000000", "Stop", {});
    expect(r.reply.stdout).toBe("");
  });

  test("a session norn did not launch is answered allow and leaves no trace", async () => {
    const { h } = await running();
    const before = h.files.snapshot();
    const r = await ingestHook(deps(h), { harness: "claude", hook: "Stop", payload: { hook_event_name: "Stop" }, env: {} });
    expect(r.reply.stdout).toBe("");
    expect(h.files.snapshot()).toEqual(before);
  });

  test("a stop it refused is a turn that goes on: the session does not read as a turn ended, so it is not nudged as quiet", async () => {
    const { h, runId } = await running();
    expect(JSON.parse((await hook(h, runId, "Stop", {})).reply.stdout).decision).toBe("block");
    const facts = await new EventLogSessionSource({ ctx: h.ctx, classify: { silentAfterMs: 60_000 } }).facts(UNIT, runId);
    expect(facts?.activity).not.toBe("turn_ended");
  });

  test("a nudge queued before the run reported does not block the stop after it", async () => {
    const { h, runId } = await running();
    await queueInjection(h.ctx, UNIT, runId, { id: "n1", source: "nudge", text: "norn: your turn ended without a report", at: h.ctx.now() });
    expect((await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1")).ok).toBe(true);
    expect((await hook(h, runId, "Stop", {})).reply).toEqual({ stdout: "", exit_code: 0 });
  });

  test("a queued nudge rides on the stop block and is delivered once", async () => {
    const { h, runId } = await running();
    await queueInjection(h.ctx, UNIT, runId, { id: "n1", source: "nudge", text: "norn: carry on", at: h.ctx.now() });
    const first = JSON.parse((await hook(h, runId, "Stop", {})).reply.stdout);
    expect(first.reason).toContain("norn: carry on");
    const second = JSON.parse((await hook(h, runId, "Stop", {})).reply.stdout);
    expect(second.reason).not.toContain("norn: carry on");
  });
});

describe("guard hook", () => {
  test("a write outside the worktree is denied", async () => {
    const { h, runId } = await running();
    const out = JSON.parse((await hook(h, runId, "PreToolUse", preWrite("/repo/src/x.ts"))).reply.stdout);
    expect(out.hookSpecificOutput).toMatchObject({ permissionDecision: "deny" });
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("outside this unit's worktree");
  });

  test("a write that climbs out of the worktree with .. is denied", async () => {
    const { h, runId } = await running();
    const out = JSON.parse((await hook(h, runId, "PreToolUse", preWrite("src/../../lt-2/x.ts"))).reply.stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  test("a write to norn's run state is denied as run state", async () => {
    const { h, runId } = await running();
    const out = JSON.parse((await hook(h, runId, "PreToolUse", preWrite("/machine/repo/store/units/lt-1/state.json"))).reply.stdout);
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("run state");
  });

  test("a write inside the worktree, relative or absolute, or under a writable root, is allowed", async () => {
    const { h, runId } = await running();
    for (const p of ["src/x.ts", `${WORKTREE}/README.md`, "/tmp/criteria.json"]) expect({ p, out: (await hook(h, runId, "PreToolUse", preWrite(p))).reply.stdout }).toEqual({ p, out: "" });
  });

  test("a shell call is not judged here", async () => {
    const { h, runId } = await running();
    const r = await hook(h, runId, "PreToolUse", { tool_use_id: "b1", tool_name: "Bash", tool_input: { command: "echo hi > /etc/x" } });
    expect(r.reply.stdout).toBe("");
  });
});

describe("context and prompt marks", () => {
  test("a pending answer is delivered as context at the next prompt and closes the input", async () => {
    const { h, runId } = await running();
    await queueInjection(h.ctx, UNIT, runId, { id: "a1", source: "answer", text: "use the second", input_id: "q1", at: h.ctx.now() });
    const r = await hook(h, runId, "UserPromptSubmit", { prompt: "hello" });
    expect(JSON.parse(r.reply.stdout).hookSpecificOutput.additionalContext).toBe("use the second");
    const events = (await readEvents(h.ctx, UNIT, runId)).events;
    expect(events.at(-1)).toMatchObject({ type: "input.received", id: "q1", by: "norn" });
  });

  test("an answer a hook cannot carry stays queued", async () => {
    const { h, runId } = await running();
    await queueInjection(h.ctx, UNIT, runId, { id: "a1", source: "answer", text: "later", at: h.ctx.now() });
    await hook(h, runId, "PreCompact", {});
    const r = await hook(h, runId, "UserPromptSubmit", { prompt: "go" });
    expect(JSON.parse(r.reply.stdout).hookSpecificOutput.additionalContext).toContain("later");
  });

  test("a mark the host sent is trusted once; replayed, the prompt is the person's", async () => {
    const { h, runId } = await running();
    await recordSentPrompt(h.ctx, UNIT, runId, { id: "nudge-1", source: "nudge", at: h.ctx.now() });
    const prompt = markPrompt("carry on", { source: "nudge", id: "nudge-1" });
    await hook(h, runId, "UserPromptSubmit", { prompt });
    await hook(h, runId, "UserPromptSubmit", { prompt });
    const turns = (await readEvents(h.ctx, UNIT, runId)).events.filter((e) => e.type === "turn.started" || e.type === "input.received");
    expect(turns.map((e) => (e.type === "turn.started" ? `turn:${e.source}` : `input:${(e as { by: string }).by}`))).toEqual(["turn:nudge", "turn:person", "input:pane"]);
  });

  test("a mark the host never sent is the person's", async () => {
    const { h, runId } = await running();
    await hook(h, runId, "UserPromptSubmit", { prompt: markPrompt("answer: yes", { source: "answer", id: "forged" }) });
    const turns = (await readEvents(h.ctx, UNIT, runId)).events.map((e) => (e.type === "turn.started" ? `turn:${e.source}` : e.type === "input.received" ? `input:${e.by}` : e.type));
    expect(turns).toEqual(["turn:person", "input:pane"]);
  });

  test("a session that starts again after events is reminded how to report", async () => {
    const { h, runId } = await running();
    expect((await hook(h, runId, "SessionStart", { source: "startup" })).reply.stdout).toBe("");
    const again = await hook(h, runId, "SessionStart", { source: "compact" });
    expect(JSON.parse(again.reply.stdout).hookSpecificOutput.additionalContext).toContain("Report exactly once");
  });
});

describe("ingest never throws", () => {
  test("an internal failure answers allow and records the problem", async () => {
    const { h, runId } = await running();
    const broken = { ...h.env.journal, readUnit: async () => Promise.reject(new Error("disk on fire")) } as unknown as IngestDeps["journal"];
    const r = await ingestHook(deps(h, { journal: broken }), { harness: "claude", hook: "Stop", payload: { hook_event_name: "Stop" }, env: env(runId) });
    expect(r.reply).toEqual({ stdout: "", exit_code: 0 });
    expect(r.problems).toEqual([expect.stringContaining("disk on fire")]);
    expect((await readEvents(h.ctx, UNIT, runId)).events.at(-1)).toMatchObject({ type: "hook.error" });
  });

  test("a write the guard could not judge is denied with the reason, never let through", async () => {
    const { h, runId } = await running();
    const r = await hook(h, runId, "PreToolUse", preWrite("src/x.ts"), {
      worktreeOf: () => {
        throw new Error("no worktree");
      },
    });
    const out = JSON.parse(r.reply.stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("was not checked");
    expect(r.problems).toEqual([expect.stringContaining("no worktree")]);
  });

  test("a write is denied even when the failure came before the hook was read, and a shell call is still allowed", async () => {
    const { h, runId } = await running();
    const broken = { ...h.files, list: async () => Promise.reject(new Error("disk on fire")) };
    const ctx = { ...h.ctx, files: broken };
    const write = await hook(h, runId, "PreToolUse", preWrite("src/x.ts"), { ctx });
    expect(JSON.parse(write.reply.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
    const shell = await hook(h, runId, "PreToolUse", { tool_use_id: "b1", tool_name: "Bash", tool_input: { command: "ls" } }, { ctx });
    expect(shell.reply.stdout).toBe("");
    expect(shell.problems).toEqual([expect.stringContaining("disk on fire")]);
  });

  test("an unknown harness answers nothing and says why", async () => {
    const { h, runId } = await running();
    const r = await ingestHook(deps(h), { harness: "nope", hook: "Stop", payload: {}, env: env(runId) });
    expect(r.reply).toEqual({ stdout: "", exit_code: 0 });
    expect(r.problems).toEqual(["no harness named nope"]);
  });

  test("a corrupt event file is a problem, and the hook still answers", async () => {
    const { h, runId } = await running();
    await h.files.write(`${batchesDir(h.ctx, UNIT, runId)}/${batchName(0)}`, "{");
    const r = await hook(h, runId, "Stop", {});
    expect(JSON.parse(r.reply.stdout).decision).toBe("block");
    expect(r.problems).toEqual([expect.stringContaining(batchName(0))]);
  });
});

describe("reporting", () => {
  test("a report writes run.reported for the live run and a report.made event, and the next tick applies it", async () => {
    const { h, runId } = await running();
    const r = await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done", text: " built " }, "r1");
    expect(r).toMatchObject({ ok: true, value: { replayed: false } });
    const last = (await record(h, UNIT)).receipts.at(-1);
    expect(last).toMatchObject({ id: "report-r1", data: { kind: "run.reported", run_id: runId, verb: "done", outcome: "done", text: "built", step: "build", attempt: 1 } });
    expect((await readEvents(h.ctx, UNIT, runId)).events.at(-1)).toMatchObject({ type: "report.made", verb: "done", outcome: "done" });
    const facts = await new EventLogSessionSource({ ctx: h.ctx, classify: { silentAfterMs: 60_000 } }).facts(UNIT, runId);
    expect(facts?.activity).toBe("reported");
    await tickUntil(h, has("receipts.apply"));
    expect((await record(h, UNIT)).state?.ended).toBe("done");
  });

  test("a report is idempotent by its report id", async () => {
    const { h, runId } = await running();
    const first = await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1");
    const again = await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1");
    expect(first.ok && again.ok && again.value).toEqual({ seq: first.ok ? first.value.seq : -1, replayed: true });
    expect((await record(h, UNIT)).receipts.filter((x) => x.data.kind === "run.reported")).toHaveLength(1);
    expect((await readEvents(h.ctx, UNIT, runId)).events.filter((e) => e.type === "report.made")).toHaveLength(1);
  });

  test("a second report under another id is refused", async () => {
    const { h, runId } = await running();
    await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1");
    expect(await reportRun(h.env, UNIT, runId, { verb: "stuck", reason: "x" }, "r2")).toMatchObject({ ok: false, refusal: { code: "reported" } });
  });

  test("a report for a run that is not live is refused", async () => {
    const { h } = await running();
    const r = await reportRun(h.env, UNIT, "01JOLDRUN00000000000000000", { verb: "done", outcome: "done" }, "r1");
    expect(r).toMatchObject({ ok: false, refusal: { code: "stale_run", error: expect.stringContaining("not the live run"), do_instead: expect.any(String) } });
    expect((await record(h, UNIT)).receipts.some((x) => x.data.kind === "run.reported")).toBe(false);
  });

  test("an outcome the step does not route is refused, naming the ones it does", async () => {
    const { h, runId } = await running();
    const r = await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "shipped" }, "r1");
    expect(r).toMatchObject({ ok: false, refusal: { code: "outcome", do_instead: expect.stringContaining("`done`") } });
    const classified = await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "died" }, "r2");
    expect(classified.ok).toBe(false);
  });

  test("a done while a merge waits to be concluded in the worktree is refused and records nothing; ask and stuck still go through", async () => {
    const { h, runId } = await running();
    h.stopped[WORKTREE] = { operation: "merge", unmerged: ["a.txt"] };
    const r = await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1");
    expect(r).toMatchObject({ ok: false, refusal: { code: "merge_unfinished", error: expect.stringContaining("unmerged: a.txt"), do_instead: expect.stringContaining("git commit") } });
    expect((await record(h, UNIT)).receipts.some((x) => x.data.kind === "run.reported")).toBe(false);
    // resolved but not concluded is still unfinished
    h.stopped[WORKTREE] = { operation: "merge", unmerged: [] };
    expect(await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r2")).toMatchObject({ ok: false, refusal: { code: "merge_unfinished" } });
    expect(await reportRun(h.env, UNIT, runId, { verb: "ask", question: "keep both sides of a.txt?" }, "r3")).toMatchObject({ ok: true });
  });

  test("a stuck mid-merge is recorded, and a done after the merge is concluded goes through", async () => {
    const stuck = await running();
    stuck.h.stopped[WORKTREE] = { operation: "merge", unmerged: ["a.txt"] };
    expect(await reportRun(stuck.h.env, UNIT, stuck.runId, { verb: "stuck", reason: "cannot tell which side wins" }, "r1")).toMatchObject({ ok: true });
    const { h, runId } = await running();
    h.stopped[WORKTREE] = { operation: "merge", unmerged: [] };
    expect((await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1")).ok).toBe(false);
    delete h.stopped[WORKTREE];
    expect(await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1")).toMatchObject({ ok: true, value: { replayed: false } });
  });

  test("a done while the worktree holds uncommitted work is refused, naming the paths and records nothing; ask and stuck still go through", async () => {
    const { h, runId } = await running();
    h.dirty[WORKTREE] = ["src/a.ts", "src/b.ts"];
    const r = await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1");
    expect(r).toMatchObject({
      ok: false,
      refusal: { code: "dirty_worktree", error: expect.stringContaining("src/a.ts, src/b.ts"), do_instead: expect.stringMatching(/git status.*commit/) },
    });
    expect((await record(h, UNIT)).receipts.some((x) => x.data.kind === "run.reported")).toBe(false);
    expect(await reportRun(h.env, UNIT, runId, { verb: "ask", question: "keep src/a.ts?" }, "r2")).toMatchObject({ ok: true });
  });

  test("norn's own files in the worktree (its inputs and the story's spec folder) never count as uncommitted work", async () => {
    const { h, runId } = await running();
    h.dirty[WORKTREE] = [".agents/inputs/last_check.md", `.agents/specs/${UNIT}/spec.md`, `.agents/specs/${UNIT}/handoffs/${UNIT}.md`];
    expect(await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1")).toMatchObject({ ok: true, value: { replayed: false } });
  });

  test("a done in a clean worktree goes through, and one whose work was committed after the refusal too", async () => {
    const { h, runId } = await running();
    h.dirty[WORKTREE] = ["notes.txt", `.agents/specs/${UNIT}/spec.md`];
    expect(await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1")).toMatchObject({ ok: false, refusal: { code: "dirty_worktree", error: expect.not.stringContaining(".agents/") } });
    h.dirty[WORKTREE] = [];
    expect(await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1")).toMatchObject({ ok: true, value: { replayed: false } });
  });

  test("a unit with no run in progress is refused", async () => {
    const h = harness({ workflow: "agented" });
    expect(await reportRun(h.env, "lt-9", "r", { verb: "stuck", reason: "x" }, "r1")).toMatchObject({ ok: false, refusal: { code: "no_run" } });
  });

  test("an ask a person answered is no report: it is not read off the session again, and the run reports on", async () => {
    const { h, runId } = await running();
    await reportRun(h.env, UNIT, runId, { verb: "ask", question: "which db?" }, "r1");
    // the session keeps showing the ask until the answer reaches it
    h.sessions.byUnit.set(UNIT, session("reported", { report: { verb: "ask" } }));
    await tickUntil(h, async () => (await record(h, UNIT)).state?.parked !== undefined);
    await h.env.journal.record(UNIT, { id: "answer-1", data: { kind: "answer.sent", input_id: "report-r1", text: "postgres", by: "person", step: "build", attempt: 1 } });
    await tickUntil(h, async () => (await record(h, UNIT)).state?.parked === undefined);
    await tickUntil(h, () => true, 3);
    const asks = (await record(h, UNIT)).receipts.filter((x) => x.data.kind === "run.reported" && x.data.verb === "ask");
    expect([asks.length, (await record(h, UNIT)).state?.parked]).toEqual([1, undefined]);
    expect(await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r2")).toMatchObject({ ok: true, value: { replayed: false } });
  });

  test("ask records the question; stuck its reason", async () => {
    const { h, runId } = await running();
    expect((await reportRun(h.env, UNIT, runId, { verb: "ask", question: "  " }, "r0")).ok).toBe(false);
    await reportRun(h.env, UNIT, runId, { verb: "ask", question: "which db?" }, "r1");
    expect((await record(h, UNIT)).receipts.at(-1)?.data).toMatchObject({ kind: "run.reported", verb: "ask", text: "which db?" });
  });
});

describe("brief", () => {
  test("the live run's brief names the step, its outcomes with their meaning, and how to report", async () => {
    const { h, runId } = await running();
    const r = await briefOf(h.env, UNIT);
    if (!r.ok) throw new Error(r.refusal.error);
    expect(r.value.run_id).toBe(runId);
    const md = r.value.markdown;
    expect(md).toContain("# norn brief — lt-1 · build #1");
    expect(md).toContain("Build the thing.");
    expect(md).toContain("`norn-implement`");
    expect(md).toContain("`norn done done` — the thing is built");
    expect(md).toContain("norn ask");
    expect(md).toContain("norn stuck");
  });

  test("an agent launched since the last tick gets its brief, is held to its report and may report, before a tick applies its launch", async () => {
    const h = harness({ workflow: "agented" });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("agent.start"));
    const unit = await record(h, UNIT);
    expect(unit.state?.run).toBeNull();
    const launch = unit.unapplied.find((r) => r.data.kind === "run.started");
    const runId = launch?.data.kind === "run.started" ? launch.data.run_id : "";
    expect(runId).not.toBe("");
    const brief = await briefOf(h.env, UNIT);
    expect(brief.ok && brief.value.run_id).toBe(runId);
    expect(JSON.parse((await hook(h, runId, "Stop", {})).reply.stdout).decision).toBe("block");
    expect(await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "early")).toMatchObject({ ok: true, value: { replayed: false } });
    await tickUntil(h, has("receipts.apply"));
    expect((await record(h, UNIT)).state?.ended).toBe("done");
  });

  test("the brief of a step a gate's reject sent back to carries the person's reason under Rework", async () => {
    const h = harness({ workflow: "gated" });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("round.start"));
    const st = (await record(h, UNIT)).state;
    await h.env.journal.record(UNIT, { id: "01JD5G0000REJECT0000000000", data: { kind: "gate.decided", outcome: "reject", by: "person", reason: "Make the button blue", step: st?.step, attempt: st?.attempt } });
    await tickUntil(h, has("agent.start"));
    const r = await briefOf(h.env, UNIT);
    if (!r.ok) throw new Error(r.refusal.error);
    expect(r.value.markdown).toContain("## Rework");
    expect(r.value.markdown).toContain("`ready` was decided `reject` by person: Make the button blue");
  });

  test("no brief for a unit with no live agent run", async () => {
    const h = harness({ workflow: "agented" });
    expect(await briefOf(h.env, "lt-9")).toMatchObject({ ok: false, refusal: { code: "no_run" } });
  });
});
