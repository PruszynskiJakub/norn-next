/**
 * gh-196 (B2, B21, B22, B23, B34; D1–D5, SK3): a supervisor's decisions, sent with `--delegated --reason`,
 * are recorded as the person's (by stays human, decide unchanged) but marked delegated, and the views
 * show them apart: `run list` marks the row, `story view` lists them in a Delegated section, `status`
 * counts them per story. Without a reason, or inside a unit worktree, a delegated command is refused.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { storyUnitDir, workflowsDir } from "@norn/store";
import type { CliDeps, CliResult } from "../../src/index.ts";
import { createHarness, type Harness, issue, runChecked } from "../../../../test/support/harness.ts";

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
const SLUGS: Record<number, string> = { 1: "gh-1-pay-invoices", 2: "gh-2-send-receipts" };
const wt = (n: number) => `${h.root}-worktrees/${SLUGS[n]}`;
const runs = (n: number) => storyUnitDir(join(wt(n), `.agents/specs/${SLUGS[n]}`));
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
  h.remote.issues = [issue(1, "Pay invoices"), issue(2, "Send receipts", ["norn", "norn:wf:asks"])];
  await h.tick("--sync");
  await until(() => [1, 2].every((n) => h.state(runs(n))?.status === "running"));
  h.report(runs(1), "done", { outcome: "done", handoff: "ready" });
  h.report(runs(2), "ask", { question: "Keep the old flag?" });
  await until(() => h.state(runs(1))?.park?.kind === "gate" && h.state(runs(2))?.park?.kind === "ask");
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
});

describe("delegated decisions are recorded apart from the person's (B21, B22, B34)", () => {
  test("approve and answer with --delegated --reason: the unit moves as on the person's decision", async () => {
    expect((await h.norn("story", "approve", "gh-1", "--delegated", "--reason", "fsd: CI green on the head, clean diff")).exit).toBe(0);
    expect((await h.norn("story", "answer", "gh-2", "Remove it", "--delegated", "--reason", "fsd: spec B4 says the flag goes")).exit).toBe(0);
    await until(() => h.state(runs(1))?.step === "$done" && h.state(runs(2))?.status === "running");
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
    await until(() => (h.state(join(wt(1), `.agents/specs/${SLUGS[1]}/runs/_story/rounds/02-asks`))?.round ?? 0) === 2);
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
  });

  test("status counts delegated decisions per story, never as an inbox item (B22)", async () => {
    const s = await h.norn("status", "--json");
    expect((s.value as { delegated: Record<string, number> }).delegated).toEqual({ "gh-1": 2, "gh-2": 1 });
    expect((await h.norn("status")).stdout).toContain("gh-1 2 delegated");
  });
});
