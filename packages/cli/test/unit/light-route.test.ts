/**
 * The light path in the shipped story and quick workflows (both copies): after a base update that
 * brought only base merges and spec-folder bookkeeping since the last approval, the story goes
 * update → (resolve) → test → resolution review → open-pr, never through implement, QA or describe
 * unless something asks for it.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyReceipts, initialState, lightAnchor, type NumberedReceipt, validateWorkflowDefinition } from "@norn/core";
import { deriveUlid, outcomeEdge, type Receipt, type UnitState, type Workflow } from "@norn/schema";
import { parseWorkflowText } from "@norn/store";

const ROOT = join(import.meta.dir, "..", "..", "..", "..");
const COPIES = [
  ["shipped story", join(ROOT, "packages", "cli", "assets", "workflows", "story.yaml")],
  ["shipped quick", join(ROOT, "packages", "cli", "assets", "workflows", "quick.yaml")],
  ["repo story", join(ROOT, ".agents", "workflows", "story.yaml")],
  ["repo quick", join(ROOT, ".agents", "workflows", "quick.yaml")],
] as const;

function load(path: string): Workflow {
  const r = parseWorkflowText(readFileSync(path, "utf8"), path);
  if (!r.ok) throw new Error(`${path}: ${JSON.stringify(r)}`);
  return r.value;
}
const edges = (wf: Workflow, step: string) =>
  Object.fromEntries(Object.entries(wf.steps[step]?.outcomes ?? {}).map(([o, e]) => [o, outcomeEdge(e as Parameters<typeof outcomeEdge>[0])]));
const targets = (wf: Workflow, step: string) => Object.fromEntries(Object.entries(edges(wf, step)).map(([o, e]) => [o, e.to]));

const UNIT = { story: "gh-1", slice: null, key: "gh-1", dir: "_story" } as const;
let seq = 0;
/** One receipt of the kind the step it ends writes: classify for git, check for check, done for an agent. */
function ending(st: UnitState, wf: Workflow, outcome: string): Receipt {
  const head = { receipt_id: deriveUlid("01JCCCCCCCCCCCCCCCCCCCCCCC", seq++), run_id: null, step: st.step, attempt: st.attempt, at: "2026-11-11T10:00:00.000Z" };
  const type = wf.steps[st.step]?.type;
  if (type === "check") return { ...head, kind: "check", by: "norn", outcome, command: "x", exit_code: outcome === "pass" ? 0 : 1, duration_ms: 1, output_tail: "" } as Receipt;
  if (type === "agent") return { ...head, kind: "done", by: "agent", outcome, handoff: "h" } as Receipt;
  return { ...head, kind: "classify", by: "norn", outcome, rule: `git.${st.step}`, route: "t" } as Receipt;
}
/** From `at`, end each step in turn with the outcome given; the states visited, last one included. */
function walk(wf: Workflow, at: string, outcomes: string[], counters: Record<string, number> = {}): UnitState[] {
  let st = initialState({ unit: UNIT, workflow: wf, workflowName: wf.name, workflowHash: "a".repeat(64), now: "2026-11-11T10:00:00.000Z", at });
  st = { ...st, counters: { ...st.counters, ...counters } };
  const seen = [st];
  for (const outcome of outcomes) {
    const nr: NumberedReceipt = { n: st.applied_through + 1, file: "", receipt: ending(st, wf, outcome) };
    const res = applyReceipts(st, [nr], { workflow: wf, now: "2026-11-11T10:00:00.000Z" });
    expect({ at: st.step, outcome, rejected: res.rejected }).toEqual({ at: st.step, outcome, rejected: [] });
    st = res.state;
    seen.push(st);
  }
  return seen;
}

describe.each(COPIES)("%s workflow routes the light path", (_name, path) => {
  const wf = load(path);
  const text = readFileSync(path, "utf8");

  test("it validates, and git: update routes done → test, clean → test-merge, resolved → test-resolution", () => {
    expect(validateWorkflowDefinition(wf).issues).toEqual([]);
    expect(targets(wf, "update")).toEqual({ done: "test", clean: "test-merge", resolved: "test-resolution", conflict: "resolve" });
  });

  test("the merge test passes to open-pr, the resolution test to the resolution review, and both fail to implement", () => {
    expect(edges(wf, "test-merge")).toEqual({ pass: { to: "open-pr" }, fail: { to: "implement", counter: "test_loop" } });
    expect(edges(wf, "test-resolution")).toEqual({ pass: { to: "resolution-review" }, fail: { to: "implement", counter: "test_loop" } });
  });

  test("the test command is written once and every test step runs it", () => {
    const run = (s: string) => (wf.steps[s] as { run?: string }).run;
    expect(run("test")).toBeTruthy();
    expect([run("test-merge"), run("test-resolution")]).toEqual([run("test"), run("test")]);
    expect([text.match(/run: &test-run\b/g)?.length, text.match(/run: \*test-run\b/g)?.length]).toEqual([1, 2]);
  });

  test("the resolution review is norn-review over the spec and the resolution", () => {
    expect(wf.steps["resolution-review"]).toMatchObject({ type: "agent", skill: "norn-review", inputs: ["spec", "resolution"] });
    expect(edges(wf, "resolution-review")).toMatchObject({
      approve: { to: "open-pr" },
      redescribe: { to: "describe" },
      changes_requested: { to: "resolve", counter: "resolution_loop" },
    });
  });

  test("a clean update skips the resolution review: merge test, then open-pr", () => {
    const seen = walk(wf, "update", ["clean", "pass"]).map((s) => s.step);
    expect(seen).toEqual(["update", "test-merge", "open-pr"]);
  });

  test("a resolved update: resolution test, then the resolution review", () => {
    expect(walk(wf, "update", ["resolved", "pass"]).map((s) => s.step)).toEqual(["update", "test-resolution", "resolution-review"]);
  });

  test("blocking findings of the resolution review go back to resolve on resolution_loop, not to implement", () => {
    const last = walk(wf, "resolution-review", ["changes_requested"]).at(-1);
    expect({ step: last?.step, loop: last?.counters.resolution_loop }).toEqual({ step: "resolve", loop: 1 });
  });

  test("approve goes to open-pr without describe; redescribe runs describe again first", () => {
    expect(walk(wf, "resolution-review", ["approve"]).map((s) => s.step)).toEqual(["resolution-review", "open-pr"]);
    expect(walk(wf, "resolution-review", ["redescribe", "done"]).map((s) => s.step)).toEqual(["resolution-review", "describe", "open-pr"]);
  });

  test("a light-path update resets base_conflict_loop like a full one: conflicts on one base move count, not across moves", () => {
    for (const outcome of ["done", "clean", "resolved"]) expect({ outcome, loop: walk(wf, "update", [outcome], { base_conflict_loop: 1 }).at(-1)?.counters.base_conflict_loop }).toEqual({ outcome, loop: 0 });
  });

  describe("the light path is measured only from an approval the PR already holds", () => {
    const SHA = (c: string) => c.repeat(40);
    /** The round's receipts, numbered in order: `step:outcome`, with `step:approve@c` an approval at head `c`. */
    const round = (...ends: string[]): NumberedReceipt[] =>
      ends.map((e, i) => {
        const [stepOutcome, at] = e.split("@") as [string, string | undefined];
        const [step, outcome] = stepOutcome.split(":") as [string, string];
        const head = { receipt_id: deriveUlid("01JDDDDDDDDDDDDDDDDDDDDDDD", i), run_id: null, step, at: "2026-11-11T10:00:00.000Z", ...(at ? { head_sha: SHA(at) } : {}) };
        const type = wf.steps[step]?.type;
        const receipt = type === "gate" ? { ...head, kind: outcome, by: "person" } : type === "agent" ? { ...head, kind: "done", by: "agent", outcome, handoff: "h" } : { ...head, kind: "classify", by: "norn", outcome, rule: `git.${step}`, route: "t" };
        return { n: i + 1, file: "", receipt: receipt as Receipt };
      });

    const hasQa = wf.steps["human-qa"] !== undefined;
    test.if(hasQa)("a conflicting base move at human-qa in the first round, after a rework review approve, takes the full path", () => {
      // test fail → implement → review approve → test pass → qa partial → human-qa parked, no PR yet
      const rs = round("slices:done", "update:done", "test:fail", "implement:done", "review:approve@1", "test:pass", "qa:partial", "human-qa:stale", "update:conflict", "resolve:done");
      expect(lightAnchor(rs, wf)).toBeNull();
    });

    test.if(hasQa)("human-qa parked again after a ci fail's rework review approve takes the full path, though open-pr ran before it", () => {
      const rs = round("describe:done", "open-pr:done", "ci:fail", "implement:done", "review:approve@1", "test:pass", "qa:partial", "human-qa:stale");
      expect(lightAnchor(rs, wf)).toBeNull();
    });

    test.if(hasQa)("a stale ready measures from the human-qa approval open-pr went out after", () => {
      expect(lightAnchor(round("qa:partial", "human-qa:approve@1", "describe:done", "open-pr:done", "ci:pass", "ready:stale"), wf)).toBe(SHA("1"));
    });

    test("a stale ci measures from the rework review approval open-pr went out after", () => {
      expect(lightAnchor(round("ci:fail", "implement:done", "review:approve@2", "test:pass", "describe:done", "open-pr:done", "ci:stale"), wf)).toBe(SHA("2"));
    });

    test("an approve at a step reachable only past open-pr (ready) anchors without a later open-pr", () => {
      expect(lightAnchor(round("open-pr:done", "ci:pass", "ready:approve@3", "merge:stale"), wf)).toBe(SHA("3"));
    });
  });
});

describe("the workflow loader resolves YAML anchors", () => {
  test("an aliased test command parses to the same command in both steps", () => {
    const text = [
      "name: anchors",
      "start: a",
      "steps:",
      "  a: { type: check, run: &cmd 'bun run test && bun run typecheck', timeout: 1m, outcomes: { pass: b, fail: $stuck } }",
      "  b: { type: check, run: *cmd, timeout: 1m, outcomes: { pass: $done, fail: $stuck } }",
    ].join("\n");
    const r = parseWorkflowText(text, "anchors.yaml");
    expect(r.ok).toBe(true);
    const wf = (r as { value: Workflow }).value;
    expect([(wf.steps.a as { run: string }).run, (wf.steps.b as { run: string }).run]).toEqual(["bun run test && bun run typecheck", "bun run test && bun run typecheck"]);
  });
});
