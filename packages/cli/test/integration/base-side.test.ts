/**
 * The `base_side` input on real git: a story whose base update conflicts goes to a resolve step
 * declaring `base_side`, and `norn brief` lists, per conflicting path, the base commits since the
 * merge base that touched it, the story from each one's `Norn-Story` trailer (a squash commit's last
 * trailer block) and that story's spec and PR body on the base; a commit without the trailer is listed
 * without a story. The same holds once the resolver's merge is in progress.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BaseSidePath, BriefJson } from "@norn/core";
import { PR_BODY_FILE, SPEC_FILE, SPECS_DIR, storyDirName } from "@norn/schema";
import { workflowsDir } from "@norn/store";
import { createHarness, type Harness, installBundledSkills, issue, runChecked, sh } from "../../../../test/support/harness.ts";
import { runStateOf } from "../../../../test/support/run-state.ts";

setDefaultTimeout(30_000);

const HELD = `name: held
start: ready
steps:
  ready:
    type: gate
    outcomes:
      approve: $done
      reject: $stuck
      stale: { to: update, counter: stale_loop }
  update:
    type: git
    action: update
    outcomes: { done: ready, conflict: { to: resolve, counter: base_conflict_loop } }
  resolve:
    type: agent
    skill: norn-merge
    inputs: [spec, handoff, base_side]
    outcomes: { done: { to: update, means: "base merged into the story branch, conflicts resolved and committed" } }
counters: { base_conflict_loop: { max: 2 }, stale_loop: { max: 3 } }
`;

/** commits on the base, from a clone, then pushed: what other stories (and a hand edit) landed meanwhile */
function landOnBase(h: Harness, commits: Array<{ files: Record<string, string>; message: string }>): string[] {
  const dir = join(h.dir, `base-${Math.random().toString(36).slice(2)}`);
  sh(h.dir, ["clone", "-q", "-b", "main", h.remoteDir, dir]);
  sh(dir, ["config", "user.email", "s@example.com"]);
  sh(dir, ["config", "user.name", "Sibling"]);
  const shas: string[] = [];
  for (const c of commits) {
    for (const [file, text] of Object.entries(c.files)) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), text);
    }
    sh(dir, ["add", "-A"]);
    sh(dir, ["commit", "-q", "-m", c.message]);
    shas.push(sh(dir, ["rev-parse", "HEAD"]));
  }
  sh(dir, ["push", "-q", "origin", "main"]);
  return shas;
}

describe("base_side at norn brief", () => {
  let h: Harness;
  const wt = () => h.worktree("gh-7-add-login-form");
  const runs = () => runStateOf(join(wt(), `${SPECS_DIR}/gh-7-add-login-form`));
  const until = async (pred: () => boolean, label: string, max = 20) => {
    for (let i = 0; i < max && !pred(); i++) {
      h.clock.advance(10_000);
      await h.tick();
    }
    if (!pred()) throw new Error(`${label} not reached: ${JSON.stringify(h.state(runs()))}`);
  };
  const brief = async () => {
    const r = await runChecked(["brief", "--json"], { ...h.deps, cwd: wt() });
    return r.value as { brief: BriefJson; markdown: string };
  };

  beforeAll(async () => {
    h = await createHarness();
    h.config("provider: gh\nworkflow: held\nmode: auto\n");
    h.recordVersion();
    h.write(join(workflowsDir(h.root), "held.yaml"), HELD);
    installBundledSkills(h.root);
    writeFileSync(join(h.root, "a.txt"), "one\n");
    writeFileSync(join(h.root, "b.txt"), "one\n");
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "norn init"]);
    h.git(["push", "-q", "origin", "main"]);
    h.remote.issues = [issue(7, "Add login form")];
  });
  afterAll(() => h.cleanup());

  test("the brief lists the base side per conflicting path, before and during the resolver's merge", async () => {
    await h.tick();
    h.clock.advance(10_000);
    await h.tick("--sync");
    await until(() => h.state(runs())?.step === "ready" && h.state(runs())?.status === "parked", "ready");
    // the story's side of both files
    writeFileSync(join(wt(), "a.txt"), "story side\n");
    writeFileSync(join(wt(), "b.txt"), "story side\n");
    h.git(["add", "-A"], wt());
    h.git(["commit", "-q", "-m", "story edits a and b", "--trailer", "Norn-Tick: 01JBQ6ZK3E8Y4V5W6X7Y8Z9ABC"], wt());

    const other = `${SPECS_DIR}/${storyDirName("gh-5", "login-rules")}`;
    const [squash, unrelated, hand] = landOnBase(h, [
      {
        // a squash merge of gh-5: the commits' trailers concatenated, the last block carries the story
        files: { "a.txt": "gh-5 side\n", [`${other}/${SPEC_FILE}`]: "# Login rules\n", [`${other}/${PR_BODY_FILE}`]: "Why a.txt changed\n" },
        message: "Login rules (#5)\n\n* implement\n\nNorn-Tick: 01JAAAAAAAAAAAAAAAAAAAAAAA\n\n* review fixes\n\nNorn-Story: gh-5\nNorn-Tick: 01JBBBBBBBBBBBBBBBBBBBBBBB",
      },
      { files: { "c.txt": "elsewhere\n" }, message: "Elsewhere\n\nNorn-Story: gh-6" },
      { files: { "a.txt": "gh-5 side\nhand fix\n", "b.txt": "hand side\n" }, message: "hand fix on main" },
    ]) as [string, string, string];
    expect(unrelated).toBeTruthy();

    h.clock.advance(10_000);
    await h.tick("--sync");
    await until(() => h.state(runs())?.step === "resolve" && h.state(runs())?.status === "running", "resolve running");

    const expected: BaseSidePath[] = [
      {
        path: "a.txt",
        commits: [
          { sha: hand, subject: "hand fix on main", story: null, spec: null, pr: null },
          { sha: squash, subject: "Login rules (#5)", story: "gh-5", spec: `${other}/${SPEC_FILE}`, pr: `${other}/${PR_BODY_FILE}` },
        ],
      },
      { path: "b.txt", commits: [{ sha: hand, subject: "hand fix on main", story: null, spec: null, pr: null }] },
    ];
    const first = await brief();
    expect(first.brief.rework?.base).toMatchObject({ sha: hand, conflicts: ["a.txt", "b.txt"] });
    expect(first.brief.rework?.base?.side).toEqual(expected);
    expect(first.markdown).toContain(`  - \`${squash.slice(0, 12)}\` Login rules (#5) — story gh-5: spec \`${other}/${SPEC_FILE}\`, PR body \`${other}/${PR_BODY_FILE}\``);
    expect(first.markdown).toContain(`  - \`${hand.slice(0, 12)}\` hand fix on main — no story (made outside norn)`);

    // the resolver merges; with the merge in progress the base side is the same
    expect(Bun.spawnSync(["git", "merge", "--no-ff", hand], { cwd: wt() }).exitCode).not.toBe(0);
    expect((await brief()).brief.rework?.base?.side).toEqual(expected);
    h.git(["merge", "--abort"], wt());
  });
});
