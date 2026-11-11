/**
 * Ask instead of abort on real git: a resolver that needs a person's decision asks with the base
 * merge still in progress in the story worktree. The answer resumes the same resolve step with the
 * merge in place; a clean watch exit keeps that story's claim (and only that one) without blocking;
 * `norn story handoff` refuses the story while the merge waits.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { claimRef, SPECS_DIR } from "@norn/schema";
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
    inputs: [spec, handoff]
    outcomes: { done: { to: update, means: "base merged into the story branch, conflicts resolved and committed" } }
counters: { base_conflict_loop: { max: 2 }, stale_loop: { max: 3 } }
`;

describe("ask with the base merge in progress", () => {
  let h: Harness;
  const WT = "gh-7-add-login-form";
  const OTHER = "gh-8-add-logout";
  const wt = () => h.worktree(WT);
  const runs = () => runStateOf(join(wt(), `${SPECS_DIR}/${WT}`));
  const otherRuns = () => runStateOf(join(h.worktree(OTHER), `${SPECS_DIR}/${OTHER}`));
  const until = async (pred: () => boolean, label: string, max = 20) => {
    for (let i = 0; i < max && !pred(); i++) {
      h.clock.advance(10_000);
      await h.tick();
    }
    if (!pred()) throw new Error(`${label} not reached: ${JSON.stringify(h.state(runs()))}`);
  };
  const merging = () => Bun.spawnSync(["git", "rev-parse", "-q", "--verify", "MERGE_HEAD"], { cwd: wt() }).exitCode === 0;
  const unmerged = () => sh(wt(), ["diff", "--name-only", "--diff-filter=U"]);
  const remoteClaim = (story: string) => sh(h.dir, ["ls-remote", h.remoteDir, claimRef(story)]);

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
    h.remote.issues = [issue(7, "Add login form"), issue(8, "Add logout")];
  });
  afterAll(() => h.cleanup());

  test("the resolver asks mid-merge; the answer resumes the same resolve with the merge still in progress", async () => {
    await h.tick();
    h.clock.advance(10_000);
    await h.tick("--sync");
    await until(() => h.state(runs())?.step === "ready" && h.state(otherRuns())?.step === "ready", "both at ready");
    // the story's side of both files
    writeFileSync(join(wt(), "a.txt"), "story side\n");
    writeFileSync(join(wt(), "b.txt"), "story side\n");
    h.git(["add", "-A"], wt());
    h.git(["commit", "-q", "-m", "story edits a and b", "--trailer", "Norn-Tick: 01JBQ6ZK3E8Y4V5W6X7Y8Z9ABC"], wt());
    // the base moves into a conflict
    writeFileSync(join(h.root, "a.txt"), "base side\n");
    writeFileSync(join(h.root, "b.txt"), "base side\n");
    h.git(["commit", "-q", "-am", "base edits a and b"]);
    const baseSha = h.git(["rev-parse", "HEAD"]);
    h.git(["push", "-q", "origin", "main"]);
    h.clock.advance(10_000);
    await h.tick("--sync");
    await until(() => h.state(runs())?.step === "resolve" && h.state(runs())?.status === "running", "resolve running");
    const attempt = h.state(runs())?.attempt;

    // the resolver merges, resolves b.txt, and asks about a.txt with the merge kept in progress
    expect(Bun.spawnSync(["git", "merge", "--no-ff", baseSha], { cwd: wt() }).exitCode).not.toBe(0);
    writeFileSync(join(wt(), "b.txt"), "story side\nbase side\n");
    h.git(["add", "b.txt"], wt());
    h.report(runs(), "ask", { question: "a.txt: keep the story's text or the base's?" });
    await until(() => h.state(runs())?.status === "parked", "parked at the ask");
    expect(h.state(runs())).toMatchObject({ step: "resolve", attempt, park: { kind: "ask" } });
    expect(merging()).toBe(true);
    expect(unmerged()).toBe("a.txt");

    h.report(runs(), "answer", { answer: "keep both lines" }, "human");
    await until(() => h.state(runs())?.status === "running", "resolve resumed");
    expect(h.state(runs())).toMatchObject({ step: "resolve", attempt });
    // the partial resolution survived: the merge is still in progress, b.txt still resolved
    expect(merging()).toBe(true);
    expect(unmerged()).toBe("a.txt");
    expect(sh(wt(), ["diff", "--cached", "--name-only"])).toContain("b.txt");

    // it asks again: the state AC3 and AC4 start from
    h.report(runs(), "ask", { question: "a.txt: and the order?" });
    await until(() => h.state(runs())?.status === "parked", "parked at the second ask");
    expect(merging()).toBe(true);
  });

  test("story handoff refuses the story with merge_in_progress and says to answer or unstick first", async () => {
    const r = await h.norn("story", "handoff", "gh-7", "--json");
    expect(r.exit).toBe(3);
    expect(JSON.parse(r.stdout)).toMatchObject({ code: "merge_in_progress", do_instead: expect.stringContaining('norn story answer gh-7 "…"') });
    expect(JSON.parse(r.stdout).do_instead).toMatch(/unstick/);
    expect(remoteClaim("gh-7")).not.toBe("");
    expect(merging()).toBe(true);
  });

  test("a clean watch exit keeps that story's claim, releases the others' and is not blocked", async () => {
    expect(remoteClaim("gh-8")).not.toBe("");
    const r = await runChecked(["watch", "--interval", "1ms", "--max-ticks", "1", "--json"], { ...h.deps, log: () => {} });
    expect(r.exit).toBe(0);
    const released = (r.value as { released: Array<{ story: string; ok: boolean; kept?: string }> }).released;
    expect(released).toContainEqual(expect.objectContaining({ story: "gh-7", ok: true, kept: "merge_in_progress" }));
    expect(released).toContainEqual(expect.objectContaining({ story: "gh-8", ok: true }));
    expect(remoteClaim("gh-7")).not.toBe("");
    expect(remoteClaim("gh-8")).toBe("");
    expect(merging()).toBe(true);
    expect(unmerged()).toBe("a.txt");
  });
});
