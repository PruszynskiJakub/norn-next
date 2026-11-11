/**
 * The story's facts carry what happened since its ready approval, read from the story
 * unit's receipt files: decide carries the approval and the inbox lists the merges from it.
 */
import { describe, expect, test } from "bun:test";
import { relative } from "node:path";
import { appendReceipt, bindNornHome, loadLocalFacts, pinWorkflow, runStateStartDir, storyDir, storyFile, writeState, writeStoryFile } from "../../src/index.ts";
import { AT, receipt, state, tmp } from "../helpers.ts";

const LIGHT_YAML = `name: light
start: update
steps:
  update:
    type: git
    action: update
    outcomes: { done: test-merge, clean: test-merge, resolved: test-merge, conflict: test-merge }
  test-merge:
    type: check
    run: "true"
    timeout: 1m
    outcomes: { pass: open-pr, fail: $stuck }
  open-pr:
    type: git
    action: open-pr
    outcomes: { done: ready }
  ready:
    type: gate
    outcomes: { approve: merge, reject: $stuck, stale: update }
  merge:
    type: merge
    outcomes: { stale: update }
`;

const SHA = (c: string) => c.repeat(40);

function seed(outcome: "clean" | "resolved") {
  const root = tmp();
  const home = tmp();
  bindNornHome(root, home);
  const spec = storyDir(root, "gh-12", "fix-login");
  writeStoryFile(storyFile(spec), { id: "gh-12", slug: "fix-login", provider: "gh", number: 12, url: "u", title: "Fix login", assignee: null, workflow: "light", status: "active", intake_at: AT }, "\nspec\n");
  const dir = runStateStartDir(root, { key: "gh-12", spec_dir: relative(root, spec) }, "_story", "light");
  pinWorkflow(dir, LIGHT_YAML);
  const history = { anchor: SHA("a"), spec_dir: relative(root, spec), commits: [{ sha: SHA("1"), parents: [SHA("a"), SHA("b")], paths: ["x.ts"], trailers: {}, from_base: true, remerge: outcome === "clean" ? [] : ["x.ts"] }] };
  const norn = { run_id: null, by: "norn", attempt: 1 };
  appendReceipt(dir, receipt({ kind: "approve", step: "ready", run_id: null, by: "human", head_sha: SHA("a") }));
  appendReceipt(dir, receipt({ kind: "classify", step: "merge", ...norn, outcome: "stale", rule: "base moved", route: "update" }));
  appendReceipt(dir, receipt({ kind: "classify", step: "update", ...norn, outcome, rule: "git.update", route: "test-merge", history }));
  appendReceipt(dir, receipt({ kind: "check", step: "test-merge", ...norn, outcome: "pass", command: "true", exit_code: 0, duration_ms: 1, output_tail: "" }));
  appendReceipt(dir, receipt({ kind: "classify", step: "open-pr", ...norn, outcome: "done", rule: "git.open-pr", route: "ready" }));
  writeState(dir, state({ story: "gh-12", slice: null, unit_dir: "_story", workflow: "light", step: "ready", status: "parked", park: { kind: "gate", reason: "approve or reject ready", since: AT }, applied_through: 5 }));
  return { root, home };
}

describe("ready_since from the story unit's receipts", () => {
  test("a clean update since the ready approval, then a green check: it carries", async () => {
    const { root, home } = seed("clean");
    const f = await loadLocalFacts(root, { now: Date.parse(AT), home, storyWorktrees: new Map(), sliceWorktrees: new Map(), baseRef: null });
    expect(f.stories[0]?.ready_since).toEqual({ carry: true, resolved: false, merges: [SHA("1")] });
  });
  test("a resolved update since the ready approval: a person approves, the merge listed", async () => {
    const { root, home } = seed("resolved");
    const f = await loadLocalFacts(root, { now: Date.parse(AT), home, storyWorktrees: new Map(), sliceWorktrees: new Map(), baseRef: null });
    expect(f.stories[0]?.ready_since).toEqual({ carry: false, resolved: true, merges: [SHA("1")] });
  });
});
