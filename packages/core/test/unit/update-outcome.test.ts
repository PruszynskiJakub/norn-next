/**
 * The `git: update` outcome choice: `done` / `conflict` from the merge, and the light path
 * (`clean` / `resolved`) from the git summary act gathers since the last approval.
 */
import { describe, expect, test } from "bun:test";
import type { Receipt, Workflow } from "@norn/schema";
import { applyReceipts } from "../../src/apply.ts";
import { at, receipt, stateFor, storyUnit, TICK } from "../fixtures.ts";
import type { NumberedReceipt } from "../../src/facts.ts";
import { lightAnchor, type UpdateCommit, type UpdateHistory, updateOutcome } from "../../src/update-outcome.ts";

const SHA = (c: string) => c.repeat(40);
const SPEC = ".agents/specs/gh-1-x";
const ROUTED = ["done", "conflict", "clean", "resolved"];

const merge = (c: string, remerge: string[] | null = [], from_base = true): UpdateCommit => ({ sha: SHA(c), parents: [SHA("p"), SHA("q")], paths: ["src/base-change.ts"], trailers: {}, from_base, remerge });
const commit = (c: string, ...paths: string[]): UpdateCommit => ({ sha: SHA(c), parents: [SHA("p")], paths, trailers: {} });
const history = (...commits: UpdateCommit[]): UpdateHistory => ({ anchor: SHA("a"), spec_dir: SPEC, commits });

describe("the update step's outcome is chosen by a pure function of the merge result", () => {
  test("a clean merge, or a story already up to date with the base, ends done", () => {
    expect(updateOutcome({ merge: { outcome: "merged" } })).toBe("done");
    expect(updateOutcome({ merge: { outcome: "up_to_date" } })).toBe("done");
  });
  test("a conflicting merge ends conflict", () => {
    expect(updateOutcome({ merge: { outcome: "conflict", files: ["a.ts"] } })).toBe("conflict");
    expect(updateOutcome({ merge: { outcome: "conflict", files: ["a.ts"] }, history: history() }, ROUTED)).toBe("conflict");
  });
});

describe("light path: only base merges and spec-folder bookkeeping since the last approval", () => {
  test("base merges with an empty remerge-diff and spec-folder commits other than spec.md end clean", () => {
    const h = history(merge("1"), commit("2", `${SPEC}/handoffs/01-a.md`, `${SPEC}/pr.md`), commit("3"));
    expect(updateOutcome({ merge: { outcome: "merged" }, history: h }, ROUTED)).toBe("clean");
    expect(updateOutcome({ merge: { outcome: "up_to_date" }, history: history() }, ROUTED)).toBe("clean");
  });
  test("a merge since the approval that needed a resolution ends resolved", () => {
    const h = history(merge("1"), commit("2", `${SPEC}/handoffs/s.md`), merge("3", ["src/a.ts"]));
    expect(updateOutcome({ merge: { outcome: "up_to_date" }, history: h }, ROUTED)).toBe("resolved");
  });
  test("a regenerated merge is clean only with its trailer and a remerge-diff inside the regenerate mapping", () => {
    const regenerate = [{ paths: ["packages/schema/json/*.json"] }, { paths: ["docs/reference.md"] }];
    const regen = (remerge: string[] | null, trailer = true): UpdateCommit => ({ ...merge("1", remerge), trailers: trailer ? { "Norn-Regenerated": remerge?.join(", ") ?? "" } : {} });
    const outcome = (c: UpdateCommit, mapping: typeof regenerate | null = regenerate) => updateOutcome({ merge: { outcome: "merged" }, history: history(c), ...(mapping ? { regenerate: mapping } : {}) }, ROUTED);
    expect(outcome(regen(["packages/schema/json/state.schema.json", "docs/reference.md"]))).toBe("clean");
    // the trailer alone is not enough: a path outside the mapping is a resolution to review
    expect(outcome(regen(["packages/schema/json/state.schema.json", "src/a.ts"]))).toBe("resolved");
    // mapped paths without the trailer: someone resolved them by hand
    expect(outcome(regen(["docs/reference.md"], false))).toBe("resolved");
    // no mapping (the team file dropped it): nothing counts as regenerated
    expect(outcome(regen(["docs/reference.md"]), null)).toBe("resolved");
    expect(outcome(regen(null))).toBe("resolved");
  });
  test("a merge whose remerge-diff git cannot give (too old) ends resolved, never clean", () => {
    expect(updateOutcome({ merge: { outcome: "merged" }, history: history(merge("1", null)) }, ROUTED)).toBe("resolved");
  });
  test("a commit touching code since the approval (implement after a ready reject or a ci fail) ends done", () => {
    const h = history(merge("1"), commit("2", "src/fix.ts", `${SPEC}/handoffs/s.md`));
    expect(updateOutcome({ merge: { outcome: "merged" }, history: h }, ROUTED)).toBe("done");
  });
  test("a changed spec.md since the approval ends done", () => {
    expect(updateOutcome({ merge: { outcome: "merged" }, history: history(merge("1"), commit("2", `${SPEC}/spec.md`)) }, ROUTED)).toBe("done");
  });
  test("a path that only starts like the spec folder is not in it", () => {
    expect(updateOutcome({ merge: { outcome: "merged" }, history: history(commit("2", `${SPEC}-other/x.md`)) }, ROUTED)).toBe("done");
  });
  test("a merge of something other than the base ends done", () => {
    expect(updateOutcome({ merge: { outcome: "merged" }, history: history(merge("1", [], false)) }, ROUTED)).toBe("done");
  });
  test("no history (no approval in the round, or the approved head is not under the branch) ends done", () => {
    expect(updateOutcome({ merge: { outcome: "merged" }, history: null }, ROUTED)).toBe("done");
    expect(updateOutcome({ merge: { outcome: "merged" } }, ROUTED)).toBe("done");
  });
  test("a workflow that does not route clean or resolved ends done as today", () => {
    expect(updateOutcome({ merge: { outcome: "merged" }, history: history(merge("1")) }, ["done", "conflict"])).toBe("done");
    expect(updateOutcome({ merge: { outcome: "merged" }, history: history(merge("1", ["a.ts"])) }, ["done", "conflict", "clean"])).toBe("done");
    expect(updateOutcome({ merge: { outcome: "merged" }, history: history(merge("1")) }, ["done", "conflict", "resolved"])).toBe("done");
  });
});

describe("the anchor is the head at the latest approve in the round, once the PR holds it", () => {
  let n = 0;
  const num = (receipt: Partial<Receipt> & { kind: Receipt["kind"] }): NumberedReceipt => ({ n: ++n, file: "", receipt: { receipt_id: "01J", run_id: null, step: "x", at: "2026-01-01T00:00:00Z", by: "agent", ...receipt } as unknown as Receipt });
  const step = (to: string) => ({ type: "agent", skill: "s", outcomes: { done: to, approve: to } }) as never;
  // review → human-qa → describe → open-pr → ci → ready → merge, with human-qa going stale to update
  const WF = {
    name: "anchor",
    start: "review",
    steps: {
      review: step("human-qa"),
      "human-qa": { type: "gate", prompt: "p", outcomes: { approve: "describe", reject: "review", stale: "update" } },
      update: { type: "git", action: "update", outcomes: { done: "review", clean: "open-pr" } },
      describe: step("open-pr"),
      "open-pr": { type: "git", action: "open-pr", outcomes: { done: "ci" } },
      ci: { type: "check", run: "true", timeout: "1m", outcomes: { pass: "ready", fail: "review" } },
      ready: { type: "gate", prompt: "p", outcomes: { approve: "$done", reject: "review", stale: "update" } },
    },
  } as unknown as Workflow;
  const openPr = () => num({ kind: "classify", step: "open-pr", outcome: "done", rule: "git.open-pr", route: "ci" } as never);
  const review = (c: string) => num({ kind: "done", step: "review", outcome: "approve", handoff: "h", head_sha: SHA(c) } as never);
  test("an agent review approve and a gate approve both anchor; the latest wins", () => {
    const rs = [num({ kind: "approve", step: "ready", head_sha: SHA("1") }), review("2"), num({ kind: "done", step: "implement", outcome: "done", handoff: "h", head_sha: SHA("3") } as never), openPr()];
    expect(lightAnchor(rs, WF)).toBe(SHA("2"));
    expect(lightAnchor([...rs].reverse(), WF)).toBe(SHA("2"));
  });
  test("no approve in the round, or a latest approve without its head, is no anchor", () => {
    expect(lightAnchor([num({ kind: "done", step: "implement", outcome: "done", handoff: "h", head_sha: SHA("3") } as never)], WF)).toBeNull();
    expect(lightAnchor([num({ kind: "approve", step: "ready", head_sha: SHA("1") }), num({ kind: "approve", step: "human-qa" })], WF)).toBeNull();
  });
  test("an approve open-pr has not gone out after, at a step before open-pr, is no anchor: the full path keeps the person's gate and describe", () => {
    expect(lightAnchor([review("2")], WF)).toBeNull();
    expect(lightAnchor([openPr(), review("2")], WF)).toBeNull();
    // so a base move at human-qa ends done, the full path, whatever the merge brought
    const anchor = lightAnchor([review("2")], WF);
    expect(updateOutcome({ merge: { outcome: "merged" }, history: anchor ? history(merge("1")) : null }, ROUTED)).toBe("done");
  });
  test("an approve at a step reachable only past open-pr anchors on its own", () => {
    expect(lightAnchor([openPr(), num({ kind: "approve", step: "ready", head_sha: SHA("4") })], WF)).toBe(SHA("4"));
  });
});

describe("a routed light outcome moves the story like any other outcome", () => {
  const WF: Workflow = {
    name: "light",
    start: "update",
    steps: {
      update: { type: "git", action: "update", outcomes: { done: "test", clean: "test-merge", resolved: "test-resolution", conflict: "$stuck" } },
      test: { type: "check", run: "true", timeout: "1m", outcomes: { pass: "$done", fail: "$stuck" } },
      "test-merge": { type: "check", run: "true", timeout: "1m", outcomes: { pass: "$done", fail: "$stuck" } },
      "test-resolution": { type: "check", run: "true", timeout: "1m", outcomes: { pass: "$done", fail: "$stuck" } },
    },
  };
  for (const [outcome, to] of [["clean", "test-merge"], ["resolved", "test-resolution"], ["done", "test"]] as const)
    test(`update.${outcome} → ${to}`, () => {
      const st = stateFor(storyUnit(), WF);
      const r = receipt(st, "classify", { outcome, rule: "git.update", route: to }, "norn");
      const out = applyReceipts(st, [{ n: 1, file: "", receipt: r }], { workflow: WF, now: at(), tick_id: TICK });
      expect(out.state.step).toBe(to);
    });
});
