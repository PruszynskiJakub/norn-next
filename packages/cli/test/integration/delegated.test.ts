/**
 * gh-196 (B2, B21, B22, B23, B34; D1–D5, SK3): a supervisor's decisions, sent with `--delegated --reason`,
 * are recorded as the person's (by stays human, decide unchanged) but marked delegated, and the views
 * show them apart: `run list` marks the row, `story view` lists them in a Delegated section, `status`
 * counts them per story. Without a reason, or inside a unit worktree, a delegated command is refused.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { workflowsDir } from "@norn/store";
import type { CliDeps, CliResult } from "../../src/index.ts";
import { createHarness, type Harness, issue, runChecked } from "../../../../test/support/harness.ts";
import { runStateOf, storyRunStateOf } from "../../../../test/support/run-state.ts";

setDefaultTimeout(30_000);

const GATED = `name: gated
start: work
steps:
  work:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: review, means: "the change is ready to look at" } }
  review:
    type: gate
    prompt: "Look at it"
    outcomes: { approve: $done, reject: { to: work, counter: loop } }
counters: { loop: { max: 2 } }
`;

const ASKS = `name: asks
start: work
steps:
  work:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: $done, means: "finished" } }
`;

let h: Harness;
const SLUGS: Record<number, string> = { 1: "gh-1-pay-invoices", 2: "gh-2-send-receipts", 3: "gh-3-archive-invoices" };
const wt = (n: number) => `${h.root}-worktrees/${SLUGS[n]}`;
const spec = (n: number) => join(wt(n), `.agents/specs/${SLUGS[n]}`);
// gh-195 S12: a unit's run state is in the checkout's machine dir (the current round for the story)
const runs = (n: number) => runStateOf(spec(n));
const tick = async () => {
  h.clock.advance(10_000);
  return h.tick();
};
const until = async (done: () => boolean) => {
  for (let i = 0; i < 8 && !done(); i++) await tick();
  expect(done()).toBe(true);
};
const norn = (deps: Partial<CliDeps>, ...argv: string[]): Promise<CliResult> => runChecked(argv, { ...h.deps, ...deps });

interface Delegated {
  unit: string;
  round: number | null;
  step: string;
  kind: string;
  workflow?: string;
  reason: string;
}

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.config("provider: gh\nworkflow: gated\nmode: auto\n");
  h.write(join(workflowsDir(h.root), "gated.yaml"), GATED);
  h.write(join(workflowsDir(h.root), "asks.yaml"), ASKS);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(1, "Pay invoices"), issue(2, "Send receipts", ["norn", "norn:wf:asks"]), issue(3, "Archive invoices")];
  await h.tick("--sync");
  await until(() => [1, 2, 3].every((n) => h.state(runs(n))?.status === "running"));
  h.report(runs(1), "done", { outcome: "done", handoff: "ready" });
  h.report(runs(2), "ask", { question: "Keep the old flag?" });
  h.report(runs(3), "done", { outcome: "done", handoff: "ready" });
  await until(() => h.state(runs(1))?.park?.kind === "gate" && h.state(runs(2))?.park?.kind === "ask" && h.state(runs(3))?.park?.kind === "gate");
});
afterAll(() => h.cleanup());

describe("refusals", () => {
  test("--delegated without a reason is a usage error, reason_required, on every delegatable command (B23)", async () => {
    for (const argv of [
      ["story", "approve", "gh-1", "--delegated"],
      ["story", "reject", "gh-1", "--delegated", "--reason", "  "],
      ["story", "answer", "gh-2", "no", "--delegated"],
      ["run", "rerun", "gh-1", "--delegated"],
      ["story", "edit", "gh-1", "--workflow", "gated", "--delegated"],
    ]) {
      const r = await h.norn(...argv);
      expect([argv, r.exit, (r.value as { code?: string }).code]).toEqual([argv, 2, "reason_required"]);
    }
    expect(h.state(runs(1))?.park?.kind).toBe("gate");
  });

  test("a delegated command inside a unit worktree is refused: a step agent never supervises (B2, SK3)", async () => {
    const r = await norn({ cwd: wt(1) }, "story", "approve", "gh-1", "--delegated", "--reason", "fsd: looks fine");
    expect(r.exit).toBe(3);
    expect(r.value).toMatchObject({ code: "delegated_in_unit" });
  });

  test("gh-224: a step agent's plain approve or reject in a unit worktree is refused, never recorded as the person's (§6, SK3)", async () => {
    const agent = { cwd: wt(1), env: { ...h.deps.env, NORN_RUN: "01J0000000000000000000000" } };
    for (const argv of [
      ["story", "approve", "gh-1"],
      ["story", "approve"],
      ["story", "reject", "gh-1", "--reason", "not good enough"],
    ]) {
      const r = await norn(agent, ...argv);
      expect([argv, r.exit, (r.value as { code?: string }).code]).toEqual([argv, 3, "gate_by_agent"]);
      expect((r.value as { do_instead: string }).do_instead).toContain("main checkout");
    }
    expect(h.state(runs(1))?.park?.kind).toBe("gate");
  });

  test("gh-224: a person in a unit worktree (no NORN_RUN) is not refused as an agent", async () => {
    // gh-2 waits at an ask, not a gate: the person's command gets past the agent check to not_at_gate
    const r = await norn({ cwd: wt(2) }, "story", "approve", "gh-2");
    expect([r.exit, (r.value as { code?: string }).code]).toEqual([3, "not_at_gate"]);
  });
});

describe("delegated decisions are recorded apart from the person's (B21, B22, B34)", () => {
  test("approve and answer with --delegated --reason: the unit moves as on the person's decision", async () => {
    expect((await h.norn("story", "approve", "gh-1", "--delegated", "--reason", "fsd: CI green on the head, clean diff")).exit).toBe(0);
    expect((await h.norn("story", "answer", "gh-2", "Remove it", "--delegated", "--reason", "fsd: spec B4 says the flag goes")).exit).toBe(0);
    await until(() => h.state(runs(1))?.step === "$done" && h.state(runs(2))?.status === "running");
  });

  test("the person's own approve (no --delegated) shows no mark in run list or run view (B21)", async () => {
    expect((await h.norn("story", "approve", "gh-3")).exit).toBe(0);
    await until(() => h.state(runs(3))?.step === "$done");
    const rows = ((await h.norn("run", "list", "gh-3", "--json")).value as { steps: Array<{ step: string; reason: string | null; delegated?: true }> }).steps;
    const gate = rows.find((s) => s.step === "review");
    expect(gate?.reason).toBe("approve");
    expect(rows.every((s) => s.delegated === undefined)).toBe(true);
    expect((await h.norn("run", "list", "gh-3")).stdout).not.toContain("delegated");
    expect((await h.norn("run", "view", "gh-3")).stdout).not.toContain("delegated");
  });

  test("run list marks the gate row delegated with its reason; a person's own decision shows no mark", async () => {
    const r = await h.norn("run", "list", "gh-1", "--json");
    const rows = (r.value as { steps: Array<{ step: string; reason: string | null; delegated?: true }> }).steps;
    const gate = rows.find((s) => s.step === "review");
    expect(gate?.delegated).toBe(true);
    expect(gate?.reason).toBe("approve — delegated (supervisor): fsd: CI green on the head, clean diff");
    expect(rows.filter((s) => s.step !== "review").every((s) => s.delegated === undefined)).toBe(true);
    expect((await h.norn("run", "list", "gh-1")).stdout).toContain("delegated (supervisor)");
  });

  test("run view marks the delegated approve in the trace with its reason (B21)", async () => {
    const text = (await h.norn("run", "view", "gh-1")).stdout;
    expect(text).toContain("review#1 (gate)");
    expect(text).toContain("approve — delegated (supervisor): fsd: CI green on the head, clean diff");
  });

  test("a new round started with --delegated --reason carries its reason (B34)", async () => {
    const r = await h.norn("story", "edit", "gh-1", "--workflow", "asks", "--delegated", "--reason", "fsd: one seam, no contract change");
    expect(r.exit).toBe(0);
    await until(() => (h.state(join(storyRunStateOf(spec(1)), "_story/rounds/02-asks"))?.round ?? 0) === 2);
    // B34: the new round's heading in the step timeline carries the mark and the reason
    expect((await h.norn("run", "list", "gh-1")).stdout).toContain("round 2 · asks — delegated (supervisor): fsd: one seam, no contract change");
    expect((await h.norn("run", "list", "gh-1")).stdout).toContain("round 1 · gated · finished\n");
    // B34: run view shows the round start's reason too
    expect((await h.norn("run", "view", "gh-1")).stdout).toContain("round    2 · asks — delegated (supervisor): fsd: one seam, no contract change");
    expect(((await h.norn("run", "view", "gh-1", "--json")).value as { delegated_round?: { delegated_reason?: string } }).delegated_round?.delegated_reason).toBe("fsd: one seam, no contract change");
  });

  test("story view lists every delegated decision over the rounds in a Delegated section; none → no section (B22)", async () => {
    const v = (await h.norn("story", "view", "gh-1", "--json")).value as { delegated: Delegated[] };
    expect(v.delegated.map(({ unit, round, step, kind, workflow, reason }) => ({ unit, round, step, kind, workflow, reason }))).toEqual([
      { unit: "gh-1", round: 1, step: "review", kind: "approve", workflow: undefined, reason: "fsd: CI green on the head, clean diff" },
      { unit: "gh-1", round: 1, step: "$done", kind: "round", workflow: "asks", reason: "fsd: one seam, no contract change" },
    ]);
    const text = (await h.norn("story", "view", "gh-1")).stdout;
    expect(text).toContain("## Delegated (2)");
    expect(text).toContain("round asks — fsd: one seam, no contract change");
    const two = (await h.norn("story", "view", "gh-2", "--json")).value as { delegated: Delegated[] };
    expect(two.delegated.map((d) => [d.kind, d.reason])).toEqual([["answer", "fsd: spec B4 says the flag goes"]]);
    // a story with only the person's own decisions has none and no section
    expect(((await h.norn("story", "view", "gh-3", "--json")).value as { delegated: Delegated[] }).delegated).toEqual([]);
    expect((await h.norn("story", "view", "gh-3")).stdout).not.toContain("## Delegated");
  });

  test("status counts delegated decisions per story, never as an inbox item (B22)", async () => {
    const s = await h.norn("status", "--json");
    expect((s.value as { delegated_counts: Record<string, number> }).delegated_counts).toEqual({ "gh-1": 2, "gh-2": 1 });
    expect((await h.norn("status")).stdout).toContain("gh-1 2 delegated");
    // D5: a delegated decision is never an inbox item
    const inbox = JSON.stringify((s.value as { groups: unknown }).groups);
    expect(inbox).not.toContain("delegated");
    expect(inbox).not.toContain("fsd:");
  });
});

describe("the supervisor's watch check reads status --json (B8, B9)", () => {
  test("heartbeat.up says whether a watch ticks here, before any story is in auto: never ticked → false, a tick → true, stale → false", async () => {
    const fresh = await createHarness();
    try {
      expect((await fresh.norn("init")).exit).toBe(0);
      type Hb = { heartbeat: { up: boolean; down: boolean; last_tick_at: string | null } };
      const hb = async () => ((await fresh.norn("status", "--json")).value as Hb).heartbeat;
      // nothing is in auto: the inbox's heartbeat item (down) cannot fire, up still tells the truth
      expect(await hb()).toMatchObject({ up: false, down: false, last_tick_at: null });
      await fresh.tick();
      expect(await hb()).toMatchObject({ up: true, down: false });
      fresh.clock.advance(60 * 60_000);
      expect(await hb()).toMatchObject({ up: false, down: false });
    } finally {
      fresh.cleanup();
    }
  });
});

describe("a suspected flake goes back to its check, and a delegated reject (B42, B21)", () => {
  test("cancel the running unit, then run rerun --step --delegated --reason moves it; the rerun is marked delegated", async () => {
    // gh-2 is running `work` after its delegated answer, as a unit sent back to implement is
    expect(h.state(runs(2))?.status).toBe("running");
    expect((await h.norn("run", "rerun", "gh-2", "--step", "work", "--delegated", "--reason", "fsd: x")).exit).toBe(3);
    expect((await h.norn("run", "cancel", "gh-2")).exit).toBe(0);
    await until(() => h.state(runs(2))?.status === "stuck");
    const r = await h.norn("run", "rerun", "gh-2", "--step", "work", "--delegated", "--reason", "fsd: suspected flake: CI green on the same head");
    expect(r.exit).toBe(0);
    expect((r.value as { receipt: { delegated?: true; comment?: string } }).receipt).toMatchObject({ delegated: true });
    await until(() => h.state(runs(2))?.status === "running");
    const v = (await h.norn("story", "view", "gh-2", "--json")).value as { delegated: Delegated[] };
    expect(v.delegated.map((d) => [d.kind, d.reason])).toContainEqual(["unstick", "fsd: suspected flake: CI green on the same head"]);
  });
});

describe("earlier rounds are read from their folders on each load (S2)", () => {
  test("a failing receipt in an earlier round is reported in story list's errors, never skipped", async () => {
    const round1 = join(storyRunStateOf(spec(1)), "_story/rounds/01-gated/receipts");
    h.write(join(round1, "0099-approve.json"), "{ not json");
    const v = (await h.norn("story", "list", "--json")).value as { stories: Array<{ key: string; errors: Array<{ file: string }> }> };
    expect(v.stories.find((s) => s.key === "gh-1")?.errors.map((e) => e.file)).toContainEqual(expect.stringContaining("rounds/01-gated/receipts/0099-approve.json"));
  });
});

describe("a delegated reject (B21)", () => {
  test("reject --delegated --reason sends the unit back as the person's would, marked in run list and listed in story view", async () => {
    h.remote.issues = [...h.remote.issues, issue(4, "Refund invoices")];
    SLUGS[4] = "gh-4-refund-invoices";
    await h.tick("--sync");
    await until(() => h.state(runs(4))?.status === "running");
    h.report(runs(4), "done", { outcome: "done", handoff: "ready" });
    await until(() => h.state(runs(4))?.park?.kind === "gate");
    expect((await h.norn("story", "reject", "gh-4", "--delegated", "--reason", "fsd: B3 is not covered by a test")).exit).toBe(0);
    await until(() => h.state(runs(4))?.step === "work" && h.state(runs(4))?.status === "running");
    const rows = ((await h.norn("run", "list", "gh-4", "--json")).value as { steps: Array<{ step: string; delegated?: true; reason?: string }> }).steps;
    const gate = rows.find((s) => s.step === "review");
    expect(gate?.delegated).toBe(true);
    expect(gate?.reason).toContain("fsd: B3 is not covered by a test");
    const v = (await h.norn("story", "view", "gh-4", "--json")).value as { delegated: Delegated[] };
    expect(v.delegated.map((d) => [d.kind, d.step, d.reason])).toEqual([["reject", "review", "fsd: B3 is not covered by a test"]]);
  });
});
