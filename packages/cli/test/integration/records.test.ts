/**
 * Durable records and pulled facts (P2, GR6, Q6): the `ready` approve records the head it saw
 * (F35), commits norn did not make are facts and traced once (Q6), a PR left open whose head is on
 * the fetched base is merged by ancestry and cleaned up (F34), the done record carries how the PR
 * landed, and a story stays in `status` after its worktree is gone even though the main checkout's
 * local `main` is stale (F36).
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cpSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { StoryFacts } from "@norn/core";
import { baseCacheDir, baseSpecsRoot, defaultBaseRef, readTickInputs, readTrace, repoConfigPath, workflowsDir, storyUnitDir } from "@norn/store";
import type { TickReport } from "../../src/index.ts";
import { createHarness, type Harness, issue } from "../../../../test/support/harness.ts";

// whole flows over real git, several ticks each: 5 s is too tight on a loaded machine (full suite)
setDefaultTimeout(30_000);

const READY = `name: ready
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: ready }
  ready:
    type: gate
    prompt: "Read the PR"
    outcomes: { approve: $done, reject: { to: implement, counter: ready_loop } }
counters:
  ready_loop: { max: 2 }
`;

const CONFIG = `agents:
  claude: { adapter: claude }
remote: { provider: gh, label: norn, sync_interval: 5m }
default_workflow: ready
default_mode: auto
`;

const acted = (r: TickReport) => r.decisions.filter((d) => d.kind !== "noop" && d.rule !== "claim.renew").map((d) => `${d.unit} ${d.kind}${d.ok ? "" : ` FAILED ${d.error}`}`);

/** StoryFacts of `key` as the last tick observed them (from the tick trace, O5). */
function lastFacts(h: Harness, key: string): StoryFacts | undefined {
  const ticks = readTrace(h.root, { types: ["tick"] }).events;
  const last = ticks.at(-1);
  if (last?.type !== "tick") return undefined;
  const read = readTickInputs(h.root, last);
  return read.ok ? read.inputs.facts.stories.find((s) => s.key === key) : undefined;
}

async function bootTo(h: Harness, n: number, title: string, runs: () => string) {
  expect((await h.norn("init")).exit).toBe(0);
  h.write(repoConfigPath(h.root), CONFIG);
  h.write(join(workflowsDir(h.root), "ready.yaml"), READY);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(n, title)];
  for (let i = 0; i < 6 && h.state(runs())?.status !== "running"; i++) {
    h.clock.advance(10_000);
    await h.tick();
  }
  expect(h.state(runs())?.status).toBe("running");
  h.clock.advance(10_000);
  await h.tick(); // recovery commit of runs/ after the launch
}

/** What the durable-record read (store/base.ts) sees: the base ref, its specs tree and the machine dir's base copies. */
function baseDiagnostics(h: Harness): Record<string, unknown> {
  const ref = defaultBaseRef(h.root, "origin");
  const tree = ref ? Bun.spawnSync(["git", "rev-parse", "--verify", "--quiet", `${ref}:.agents/specs`], { cwd: h.root }).stdout.toString().trim() : null;
  const cache = baseCacheDir(h.root);
  const copies = existsSync(cache) ? readdirSync(cache).map((n) => ({ n, files: existsSync(join(cache, n, ".agents/specs")) ? readdirSync(join(cache, n, ".agents/specs")) : null, complete: existsSync(join(cache, n, ".complete")) })) : null;
  return { ref, tree, cache, copies, root: ref ? baseSpecsRoot(h.root, ref) : null };
}

/** Merge `branch` into main from a second clone and push it, as a person on GitHub would. */
function mergeOnRemote(h: Harness, branch: string): string {
  const other = join(h.dir, `merger-${branch}`);
  if (!existsSync(other)) h.git(["clone", "-q", h.remoteDir, other], h.dir);
  h.git(["fetch", "-q", "origin"], other);
  h.git(["checkout", "-q", "main"], other);
  h.git(["reset", "-q", "--hard", "origin/main"], other);
  h.git(["-c", "user.email=m@x", "-c", "user.name=Merger", "merge", "-q", "--no-ff", "--no-edit", `origin/${branch}`], other);
  h.git(["push", "-q", "origin", "main"], other);
  return h.git(["rev-parse", "HEAD"], other);
}

describe("records: ready head, foreign commits, merged by ancestry, durable status", () => {
  let h: Harness;
  const branch = "gh-5-record-me";
  const wt = () => `${h.root}-worktrees/${branch}`;
  const spec = `.agents/specs/${branch}`;
  const runs = () => storyUnitDir(join(wt(), spec));
  const step = (ms = 10_000) => h.clock.advance(ms);
  let readyHead = "";

  beforeAll(async () => {
    h = await createHarness();
    await bootTo(h, 5, "Record me", runs);
  });
  afterAll(() => h.cleanup());

  test("F35: approving `ready` records the story branch head (ready_head_sha)", async () => {
    h.report(runs(), "done", { outcome: "done", handoff: "built" });
    step();
    await h.tick();
    expect(h.state(runs())).toMatchObject({ step: "ready", status: "parked", park: { kind: "gate" } });
    step();
    await h.tick(); // push the parked state
    readyHead = h.git(["rev-parse", "HEAD"], wt());
    const r = await h.norn("story", "approve", "gh-5");
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ receipt: { kind: "approve", head_sha: readyHead } });
    step();
    await h.tick();
    expect(h.state(runs())).toMatchObject({ step: "$done", status: "done" });
    expect(lastFacts(h, "gh-5")?.ready_head_sha).toBe(readyHead);
  });

  test("Q6: a commit norn did not make on the story branch is a fact, traced once per sha", async () => {
    step();
    await h.tick(); // settle: norn's own commits are not foreign
    expect(lastFacts(h, "gh-5")?.foreign_commits).toBeUndefined();
    h.write(join(wt(), "hotfix.txt"), "by hand\n");
    h.git(["add", "hotfix.txt"], wt());
    h.git(["-c", "user.name=Person", "commit", "-q", "-m", "fix conflict by hand"], wt());
    const sha = h.git(["rev-parse", "HEAD"], wt());
    step();
    await h.tick();
    expect(lastFacts(h, "gh-5")?.foreign_commits).toEqual([{ sha, subject: "fix conflict by hand", author: "Person", at: expect.any(String), branch }]);
    expect(lastFacts(h, "gh-5")?.ready_head_sha).not.toBe(sha);
    step();
    await h.tick();
    const events = readTrace(h.root, { types: ["foreign_commits"] }).events;
    expect(events).toMatchObject([{ type: "foreign_commits", unit: "gh-5", commits: [{ sha, branch }] }]);
    h.git(["push", "-q", "origin", branch], wt());
  });

  test("P2 (F34): a PR left open whose head is on origin/main is merged by ancestry and cleaned up", async () => {
    const head = h.git(["rev-parse", "HEAD"], wt());
    h.remote.prs = [{ number: 7, url: "https://github.com/o/r/pull/7", state: "open", is_draft: false, head_sha: head, head: branch, base_branch: "main", merged_at: null }];
    const merge = mergeOnRemote(h, branch);
    step();
    const s = await h.norn("sync");
    expect(s.exit).toBe(0);
    expect(acted(s.value as TickReport)).toEqual(["gh-5 cleanup_merged_story"]);
    const facts = lastFacts(h, "gh-5");
    expect(facts).toMatchObject({ merged_by_ancestry: true, pr: { state: "open", head_sha: head } });
    expect(existsSync(wt())).toBe(false);
    // the done record on the base carries how it landed
    const story = h.git(["show", `origin/main:${spec}/spec.md`]);
    expect(story).toContain("status: done");
    expect(story).toContain(`merge_commit_sha: ${merge}`);
    expect(story).toContain(`head_sha: ${head}`);
    expect(story).toContain("by_ancestry: true");
    expect(h.git(["log", "-1", "--format=%(trailers:key=Norn-Merge-Commit,valueonly)", "origin/main"])).toBe(merge);
  });

  test("F36: the story stays in status after its worktree is gone; local main is stale", async () => {
    expect(h.git(["ls-tree", "--name-only", "main", ".agents/specs/"])).toBe(""); // never pulled
    step();
    const r = await h.norn("story", "list");
    expect(r.exit).toBe(0);
    const keys = (r.value as { stories: Array<{ key: string }> }).stories.map((x) => x.key);
    // seen empty once in a parallel tier run and never again (gh-118/03): say which read gave nothing
    if (!keys.includes("gh-5")) console.error("F36 diagnostics", baseDiagnostics(h));
    expect(keys).toContain("gh-5");
    expect(await h.listed("gh-5")).toMatchObject({ key: "gh-5" });
  });
});

describe("records: PR merge facts from the remote", () => {
  let h: Harness;
  const branch = "gh-6-merge-facts";
  const wt = () => `${h.root}-worktrees/${branch}`;
  const spec = `.agents/specs/${branch}`;
  const runs = () => storyUnitDir(join(wt(), spec));

  beforeAll(async () => {
    h = await createHarness();
    await bootTo(h, 6, "Merge facts", runs);
  });
  afterAll(() => h.cleanup());

  test("GR6: cleanup records merge commit, merged_by and merged_at in the done record", async () => {
    h.report(runs(), "done", { outcome: "done", handoff: "built" });
    h.clock.advance(10_000);
    await h.tick();
    h.clock.advance(10_000);
    await h.tick(); // push
    const head = h.git(["rev-parse", "HEAD"], wt());
    const merge = mergeOnRemote(h, branch);
    h.remote.prs = [{ number: 8, url: "https://github.com/o/r/pull/8", state: "merged", is_draft: false, head_sha: head, merge_commit_sha: merge, merged_by: "octo", merged_at: "2099-01-15T11:00:00Z", head: branch, base_branch: "main" }];
    h.clock.advance(10_000);
    const s = await h.norn("sync");
    expect(acted(s.value as TickReport)).toEqual(["gh-6 cleanup_merged_story"]);
    const story = h.git(["show", `origin/main:${spec}/spec.md`]);
    expect(story).toContain("status: done");
    expect(story).toContain(`merge_commit_sha: ${merge}`);
    expect(story).toContain("merged_by: octo");
    expect(story).toContain("merged_at: 2099-01-15T11:00:00.000Z");
    expect(story).not.toContain("by_ancestry");
    expect(h.git(["log", "-1", "--format=%(trailers:key=Norn-Merged-By,valueonly)", "origin/main"])).toBe("octo");
  });
});

describe("C4: an agent's commit while its unit is parked on an ask is not foreign", () => {
  let h: Harness;
  const branch = "gh-6-ask-and-commit";
  const wt = () => `${h.root}-worktrees/${branch}`;
  const runs = () => storyUnitDir(join(wt(), `.agents/specs/${branch}`));
  /** commit in the story worktree with the given committer/author date (git's own clock otherwise) */
  const commitAt = (file: string, message: string, date: string, name = "Agent") => {
    h.write(join(wt(), file), `${message}\n`);
    h.git(["add", file], wt());
    const r = Bun.spawnSync(["git", "-c", `user.name=${name}`, "commit", "-q", "-m", message], { cwd: wt(), env: { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date }, stdout: "pipe", stderr: "pipe" });
    if (r.exitCode !== 0) throw new Error(r.stderr.toString());
    return h.git(["rev-parse", "HEAD"], wt());
  };

  beforeAll(async () => {
    h = await createHarness();
    await bootTo(h, 6, "Ask and commit", runs);
  });
  afterAll(() => h.cleanup());

  test("inside the run window: not foreign; a commit outside any run of the unit still is (Q6)", async () => {
    h.report(runs(), "ask", { question: "May I run git commit?", options: ["yes", "no"] });
    h.clock.advance(10_000);
    await h.tick();
    expect(h.state(runs())).toMatchObject({ status: "parked", park: { kind: "ask" } });
    h.clock.advance(10_000);
    await h.tick(); // settle the parked state's commit
    // the agent's merge/commit lands while the unit waits on the person (permission prompt answered in the pane)
    commitAt("agent.txt", "Merge main into gh-6: resolve", h.clock.iso());
    h.clock.advance(10_000);
    await h.tick();
    expect(lastFacts(h, "gh-6")?.foreign_commits).toBeUndefined();
    expect(readTrace(h.root, { types: ["foreign_commits"] }).events).toEqual([]);
    // a person's commit dated before the unit ever ran is foreign
    const sha = commitAt("person.txt", "by hand", "2098-12-01T09:00:00Z", "Person");
    h.clock.advance(10_000);
    await h.tick();
    expect(lastFacts(h, "gh-6")?.foreign_commits).toEqual([{ sha, subject: "by hand", author: "Person", at: expect.any(String), branch }]);
  });
});

/** gh-71 B28, B29, B32 (D10): the round a story is in, and how its earlier rounds ended, in every view. */
describe("rounds in the views: status, story view, the handoff header, run list", () => {
  const TRIAGE = `name: triage
start: explore
steps:
  explore:
    type: agent
    skill: norn-qa
    outcomes: { story: { to: confirm, means: "deliver it as a story" } }
  confirm:
    type: gate
    prompt: "Confirm the triage"
    outcomes: { approve: $done, reject: { to: explore, counter: loop } }
counters: { loop: { max: 2 } }
`;
  const STORY = `name: story
start: refine
steps:
  refine:
    type: agent
    skill: norn-refine
    attended: true
    outcomes: { done: { to: build, means: "spec written" } }
  build:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: $done, means: "built" } }
`;
  const QUICK = `name: quick
start: work
steps:
  work:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: $done, means: "changed" } }
`;
  type Item = { story: string; step: string | null; round?: { n: number; workflow: string } };
  type Inbox = { groups: Record<string, Item[]> };
  type Rounds = { rounds: Array<{ n: number; workflow: string; ended: { by: string; at: string } | null }>; steps: Array<{ step: string; round?: number }> };
  let h: Harness;
  const spec = ".agents/specs/gh-16-rounds-shown";
  const wt = () => `${h.root}-worktrees/gh-16-rounds-shown`;
  const runs = () => storyUnitDir(join(wt(), spec));
  const header = () => h.read(join(wt(), spec, "runs/_story/handoff.md"));
  const next = () => {
    h.clock.advance(10_000);
    return h.tick();
  };
  beforeAll(async () => {
    h = await createHarness();
    expect((await h.norn("init")).exit).toBe(0);
    h.write(repoConfigPath(h.root), CONFIG.replace("default_workflow: ready", "default_workflow: triage"));
    h.write(join(workflowsDir(h.root), "triage.yaml"), TRIAGE);
    h.write(join(workflowsDir(h.root), "story.yaml"), STORY);
    h.write(join(workflowsDir(h.root), "quick.yaml"), QUICK);
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "norn"]);
    h.git(["push", "-q", "origin", "main"]);
    h.remote.issues = [issue(16, "Rounds shown")];
  });
  afterAll(() => h.cleanup());

  test("AC1 (B28): a story with one round shows Round 1 in the handoff header", async () => {
    for (let i = 0; i < 6 && h.state(runs())?.status !== "running"; i++) await next();
    expect(h.state(runs())).toMatchObject({ step: "explore", status: "running" });
    expect(header()).toContain("- Round 1 · Workflow: triage · Step: explore (attempt 1)");
  });

  test("AC1, AC2 (B28): in round 2 of story at refine, the header, status --json and story view show the round and its workflow next to the step", async () => {
    h.report(runs(), "done", { outcome: "story", handoff: "deliver it as a story" });
    await next();
    expect((await h.norn("story", "approve", "gh-16")).exit).toBe(0);
    await next();
    expect(h.state(runs())).toMatchObject({ step: "$done", status: "done" });
    expect((await h.norn("story", "edit", "gh-16", "--workflow", "story")).exit).toBe(0);
    await next();
    expect(h.state(runs())).toMatchObject({ workflow: "story", round: 2, step: "refine" });

    expect(header()).toContain("- Round 2 · Workflow: story · Step: refine (attempt 1)");

    const inbox = (await h.norn("status", "--json")).value as Inbox;
    const mine = Object.values(inbox.groups).flat().filter((i) => i.story === "gh-16");
    expect(mine.length).toBeGreaterThan(0);
    expect(mine).toContainEqual(expect.objectContaining({ step: "refine", round: { n: 2, workflow: "story" } }));
    for (const i of mine) expect(i.round).toEqual({ n: 2, workflow: "story" });
    // qa#1 (B28): the markdown a person reads shows the round and its workflow next to the step too
    const status = (await h.norn("status")).stdout;
    expect(status).toMatch(/gh-16 +round 2 · story · refine/);

    const json = await h.norn("story", "view", "gh-16", "--json");
    expect(json.exit).toBe(0);
    expect((json.value as { unit: unknown }).unit).toMatchObject({ round: 2, workflow: "story", step: "refine", attempt: 1 });
    const md = await h.norn("story", "view", "gh-16");
    expect(md.stdout).toContain("- Story: round 2 · story · parked at refine");
  });

  test("AC3 (B29, B32): run list heads each round and says how it ended — finished, or ended by the person at its step", async () => {
    const text = (await h.norn("run", "list", "gh-16")).stdout;
    const r1 = text.indexOf("round 1 · triage · finished");
    const r2 = text.indexOf("round 2 · story");
    expect(r1).toBeGreaterThan(-1);
    expect(r2).toBeGreaterThan(r1);
    expect(text.slice(r1, r2)).toContain("explore#1");
    expect(text.slice(r1, r2)).toContain("confirm#1");
    expect(text.slice(r2)).toContain("refine#1");
    expect(text.slice(r2)).not.toContain("explore#1");

    // round 2 ended by the person at refine, round 3 of quick started
    expect((await h.norn("story", "edit", "gh-16", "--workflow", "quick", "--force")).exit).toBe(0);
    await next();
    expect(h.state(runs())).toMatchObject({ workflow: "quick", round: 3 });
    const after = (await h.norn("run", "list", "gh-16")).stdout;
    const lines = after.split("\n").filter((l) => l.startsWith("round "));
    expect(lines).toEqual(["round 1 · triage · finished", "round 2 · story · ended by the person at refine", "round 3 · quick"]);
    const json = (await h.norn("run", "list", "gh-16", "--json")).value as Rounds;
    expect(json.rounds).toEqual([
      { n: 1, workflow: "triage", ended: { by: "workflow", at: "$done" } },
      { n: 2, workflow: "story", ended: { by: "person", at: "refine" } },
      { n: 3, workflow: "quick", ended: null },
    ]);
    expect(json.steps.filter((s) => s.step === "refine").map((s) => s.round)).toEqual([2]);
    expect(json.steps.filter((s) => s.step === "explore").map((s) => s.round)).toEqual([1]);
  });

  test("AC4 (B36): a flat record merged into the base shows one heading, round 1 · its workflow, and nothing is written", async () => {
    const OLD = ".agents/specs/gh-1-projects-and-items";
    cpSync(join(import.meta.dir, "../../../view/test/integration/fixtures/gh-1/spec"), join(h.root, OLD), { recursive: true });
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "merge gh-1 (older norn)"]);
    h.git(["push", "-q", "origin", "main"]);
    const head = h.git(["rev-parse", "HEAD"]).trim();
    const text = (await h.norn("run", "list", "gh-1")).stdout;
    expect(text.split("\n").filter((l) => l.startsWith("round "))).toEqual(["round 1 · story · finished"]);
    const json = (await h.norn("run", "list", "gh-1", "--json")).value as Rounds;
    expect(json.rounds).toEqual([{ n: 1, workflow: "story", ended: { by: "workflow", at: "$done" } }]);
    expect(existsSync(join(h.root, OLD, "runs/_story/rounds"))).toBe(false);
    expect(h.git(["status", "--porcelain", "--", OLD]).trim()).toBe("");
    expect(h.git(["rev-parse", "HEAD"]).trim()).toBe(head);
  });
});
