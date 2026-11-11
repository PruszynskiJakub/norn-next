/**
 * `norn story edit --workflow` on a finished story whose open PR conflicts with its base: restarting
 * the workflow the round ran, with no `--at`, is refused and names `norn story update-branch`;
 * another workflow, `--at`, or no conflict still starts the round.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { workflowsDir } from "@norn/store";
import { createHarness, type Harness, installBundledSkills, issue, sh } from "../../../../test/support/harness.ts";
import { runStateOf } from "../../../../test/support/run-state.ts";

// whole flows over real git, several ticks each
setDefaultTimeout(30_000);

const BASED = `name: based
start: update
steps:
  update:
    type: git
    action: update
    outcomes: { done: test, conflict: { to: resolve, counter: base_conflict_loop } }
  resolve:
    type: agent
    skill: norn-merge
    inputs: [spec, handoff]
    outcomes: { done: { to: update, means: "base merged into the story branch, conflicts resolved and committed" } }
  test:
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
    outcomes: { approve: $done, reject: $stuck }
counters: { base_conflict_loop: { max: 2 } }
`;

const OTHER = `name: other
start: draft
steps:
  draft:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: $done, means: "drafted" } }
`;

const STORIES = [
  { n: 9, slug: "gh-9-pay-by-card", title: "Pay by card", file: "a.txt" },
  { n: 10, slug: "gh-10-refund-a-card", title: "Refund a card", file: "a.txt" },
  { n: 11, slug: "gh-11-show-receipts", title: "Show receipts", file: "b.txt" },
];

describe("story edit on a finished story with a conflicting open PR", () => {
  let h: Harness;
  const wt = (slug: string) => h.worktree(slug);
  const runs = (slug: string) => runStateOf(join(wt(slug), `.agents/specs/${slug}`));
  const receiptsIn = (slug: string) => (existsSync(join(runs(slug), "receipts")) ? readdirSync(join(runs(slug), "receipts")).sort() : []);
  const until = async (pred: () => boolean, label: string) => {
    for (let i = 0; i < 30 && !pred(); i++) {
      h.clock.advance(10_000);
      await h.tick("--sync");
    }
    if (!pred()) throw new Error(`${label} not reached: ${JSON.stringify(STORIES.map((s) => h.state(runs(s.slug))))}`);
  };

  beforeAll(async () => {
    h = await createHarness();
    h.config("provider: gh\nworkflow: based\nmode: auto\n");
    h.recordVersion();
    h.write(join(workflowsDir(h.root), "based.yaml"), BASED);
    h.write(join(workflowsDir(h.root), "other.yaml"), OTHER);
    installBundledSkills(h.root);
    writeFileSync(join(h.root, "a.txt"), "one\n");
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "norn init"]);
    h.git(["push", "-q", "origin", "main"]);
    h.remote.issues = STORIES.map((s) => issue(s.n, s.title));

    // each story edits its file and is approved to $done with its PR open
    await until(() => STORIES.every((s) => h.state(runs(s.slug))?.step === "ready" && h.state(runs(s.slug))?.status === "parked"), "ready");
    for (const s of STORIES) {
      writeFileSync(join(wt(s.slug), s.file), `${s.slug}\n`);
      h.git(["add", "-A"], wt(s.slug));
      h.git(["commit", "-q", "-m", `${s.slug} edits ${s.file}`, "--trailer", "Norn-Tick: 01JBQ6ZK3E8Y4V5W6X7Y8Z9ABC"], wt(s.slug));
      expect((await h.norn("story", "approve", `gh-${s.n}`)).exit).toBe(0);
    }
    await until(() => STORIES.every((s) => h.state(runs(s.slug))?.status === "done"), "done");
    expect(h.remote.prs.filter((p) => p.state === "open")).toHaveLength(3);

    // a sibling merges a.txt into main: gh-9 and gh-10 now conflict, gh-11 does not
    const dir = join(h.dir, "sibling");
    sh(h.dir, ["clone", "-q", "--no-local", "-b", "main", h.remoteDir, dir]);
    sh(dir, ["config", "user.email", "s@example.com"]);
    sh(dir, ["config", "user.name", "Sibling"]);
    writeFileSync(join(dir, "a.txt"), "base side\n");
    sh(dir, ["add", "-A"]);
    sh(dir, ["commit", "-q", "-m", "sibling: a.txt"]);
    sh(dir, ["push", "-q", "origin", "main"]);
    h.clock.advance(10_000);
    await h.tick("--sync");
  }, 120_000);
  afterAll(() => h.cleanup());

  test("the same workflow with no --at is refused (update_branch_instead) and no round starts", async () => {
    const before = receiptsIn("gh-9-pay-by-card");
    const r = await h.norn("story", "edit", "gh-9", "--workflow", "based", "--json");
    expect(r.exit).toBe(3);
    expect(r.value).toMatchObject({ code: "update_branch_instead", do_instead: "norn story update-branch gh-9" });
    expect((r.value as { error: string }).error).toContain("a.txt");
    expect(receiptsIn("gh-9-pay-by-card")).toEqual(before);
  });

  test("a different workflow still starts the round", async () => {
    const r = await h.norn("story", "edit", "gh-9", "--workflow", "other", "--json");
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ unit: "gh-9", workflow: "other", started: true, round: 2, to: "draft" });
  });

  test("the same workflow with --at still starts the round", async () => {
    const r = await h.norn("story", "edit", "gh-10", "--workflow", "based", "--at", "update", "--json");
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ unit: "gh-10", workflow: "based", started: true, round: 2, to: "update" });
  });

  test("with no conflicting PR the same-workflow edit starts the round", async () => {
    const r = await h.norn("story", "edit", "gh-11", "--workflow", "based", "--json");
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ unit: "gh-11", workflow: "based", started: true, round: 2, to: "update" });
  });
});
