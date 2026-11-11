/**
 * The push rule once a story's PR is open: the story branch (the PR head) moves only at `open-pr`
 * and `norn story close`; every other boundary, the base update, gate approvals and claim release
 * put the story's head on its heads ref instead. A person's push to the branch is merged at the
 * next branch push, never rebased. What the remote received is logged by a real `post-receive`
 * hook (one `--` line per push).
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { headsRef, ulid } from "@norn/schema";
import { appendReceipt, inboxOpenPath, readState, workflowsDir } from "@norn/store";
import { createHarness, type Harness, issue, runChecked, sh, worktreeOf } from "../../../../test/support/harness.ts";
import { runStateOf } from "../../../../test/support/run-state.ts";

setDefaultTimeout(120_000);

const LOOP = `name: loop
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: update, means: "built" } }
  update:
    type: git
    action: update
    outcomes: { done: open-pr, conflict: $stuck }
  open-pr:
    type: git
    action: open-pr
    outcomes: { done: review }
  review:
    type: agent
    skill: norn-review
    outcomes:
      approve: { to: ready, means: "good" }
      rework: { to: implement, counter: review_loop, means: "fix it" }
  ready:
    type: gate
    outcomes: { approve: $done, reject: { to: implement, counter: review_loop } }
counters: { review_loop: { max: 5 } }
`;
const CONFIG = "provider: gh\nworkflow: loop\nmode: auto\n";

let h: Harness;

const state = (dir: string) => {
  const r = readState(dir);
  return r.ok ? r.value : null;
};
const tick = () => {
  h.clock.advance(10_000);
  return h.tick();
};
async function tickUntil(pred: () => boolean, max = 14) {
  for (let i = 0; i < max && !pred(); i++) await tick();
  expect(pred()).toBe(true);
}
function report(runsDir: string, outcome: string) {
  const st = state(runsDir);
  if (!st) throw new Error(`no state in ${runsDir}`);
  appendReceipt(runsDir, { kind: "done", receipt_id: ulid(h.clock.now()), run_id: st.run?.run_id ?? null, step: st.step, attempt: st.attempt, at: h.clock.iso(), by: "agent", outcome, handoff: `${st.step} ${outcome}` } as never);
}
const remoteRef = (ref: string): string | null => sh(h.dir, ["ls-remote", h.remoteDir, ref]).split(/\s+/)[0] || null;

const LOG = () => join(h.dir, "received.log");
function logReceived() {
  const hook = join(h.remoteDir, "hooks", "post-receive");
  writeFileSync(hook, `#!/bin/sh\nwhile read old new ref; do echo "$new $ref" >> "${LOG()}"; done\necho -- >> "${LOG()}"\nexit 0\n`);
  chmodSync(hook, 0o755);
  rmSync(LOG(), { force: true });
}
/** each push the remote took since `logReceived`, as the refs it updated */
function pushes(): string[][] {
  const out: string[][] = [[]];
  for (const l of existsSync(LOG()) ? readFileSync(LOG(), "utf8").split("\n").filter(Boolean) : []) {
    if (l === "--") out.push([]);
    else out[out.length - 1]?.push(l.split(" ")[1] as string);
  }
  return out.filter((p) => p.length);
}

interface Story {
  key: string;
  branch: string;
  wt: string;
  runs: string;
}

/** A story run through its first loop: implement → update → open-pr (the draft PR opens) → review running. */
async function atReviewWithPr(n: number, slug: string): Promise<Story> {
  const key = `gh-${n}`;
  const branch = `${key}-${slug}`;
  h.remote.issues = [...h.remote.issues, issue(n, slug, ["norn", "norn:wf:loop"])];
  await h.tick("--sync");
  const wt = () => worktreeOf(h.root, branch);
  const runs = () => runStateOf(join(wt(), `.agents/specs/${key}-${slug}`));
  await tickUntil(() => state(runs())?.status === "running");
  report(runs(), "done");
  await tickUntil(() => state(runs())?.step === "review" && state(runs())?.status === "running");
  expect(h.remote.prs.find((p) => p.head === branch)?.state).toBe("open");
  return { key, branch, wt: wt(), runs: runs() };
}

const head = (s: Story) => sh(h.root, ["rev-parse", `refs/heads/${s.branch}`]);
const branchPushes = (s: Story) => pushes().filter((p) => p.includes(`refs/heads/${s.branch}`));
/** The read model's inbox, as `norn status` shows it, and the tick-side open set. */
async function inbox(): Promise<string[]> {
  const v = (await h.norn("status")).value as { groups: Record<string, Array<{ id: string }>> };
  const open = Object.keys((JSON.parse(h.read(inboxOpenPath(h.root))) as { open: Record<string, unknown> }).open);
  return [...new Set([...Object.values(v.groups).flatMap((g) => g.map((i) => i.id)), ...open])];
}
const headItems = (ids: string[]) => ids.filter((i) => i.startsWith("head:"));

/** A person's own clone of the remote (plain git, no norn). */
function personClone(name: string): string {
  const c = join(h.dir, name);
  sh(h.dir, ["clone", "-q", h.remoteDir, c]);
  sh(c, ["config", "user.email", "person@example.com"]);
  sh(c, ["config", "user.name", "person"]);
  return c;
}

/** A commit on main pushed to the remote: the base moves under the story. */
function moveBase(name: string) {
  const c = personClone(`base-${name}`);
  writeFileSync(join(c, `${name}.txt`), `${name}\n`);
  sh(c, ["add", "-A"]);
  sh(c, ["commit", "-q", "-m", `base: ${name}`]);
  sh(c, ["push", "-q", "origin", "HEAD:main"]);
}

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.config(CONFIG);
  h.write(join(workflowsDir(h.root), "loop.yaml"), LOOP);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
});
afterAll(() => h.cleanup());

describe("once the PR is open, the story branch moves only at open-pr", () => {
  test("AC1, AC2, AC3, AC4: a rework loop with a base update pushes the story branch once, at open-pr; ready approving pushes nothing to it", async () => {
    const s = await atReviewWithPr(1, "one-loop");
    const prHead = remoteRef(`refs/heads/${s.branch}`);
    logReceived();
    // review → implement: the boundary (and the implement start) stay off the branch
    report(s.runs, "rework");
    await tickUntil(() => state(s.runs)?.step === "implement" && state(s.runs)?.status === "running");
    expect(remoteRef(`refs/heads/${s.branch}`)).toBe(prHead);
    expect(remoteRef(headsRef(s.key))).toBe(head(s));
    expect(branchPushes(s)).toEqual([]);

    // the base moves; implement → update merges it locally, on the heads ref only
    moveBase("one");
    await h.tick("--sync");
    report(s.runs, "done");
    await tickUntil(() => state(s.runs)?.step === "open-pr");
    const merge = sh(s.wt, ["log", "-1", "--format=%P", "--merges", head(s)]).split(" ");
    expect(merge.length).toBe(2);
    expect(remoteRef(`refs/heads/${s.branch}`)).toBe(prHead);
    expect(remoteRef(headsRef(s.key))).toBe(head(s));
    expect(branchPushes(s)).toEqual([]);

    // open-pr pushes the branch: the PR shows the head the story reached
    await tickUntil(() => state(s.runs)?.step === "review");
    expect(branchPushes(s).length).toBe(1);
    const atOpenPr = remoteRef(`refs/heads/${s.branch}`);
    expect(sh(h.root, ["merge-base", "--is-ancestor", merge[1] as string, atOpenPr as string])).toBe("");

    // review approves, ready approves: the PR head stays the commit open-pr pushed
    await tickUntil(() => state(s.runs)?.status === "running");
    report(s.runs, "approve");
    await tickUntil(() => state(s.runs)?.step === "ready");
    expect((await h.norn("story", "approve", s.key)).exit).toBe(0);
    await tickUntil(() => state(s.runs)?.step === "$done");
    expect(remoteRef(`refs/heads/${s.branch}`)).toBe(atOpenPr);
    expect(branchPushes(s).length).toBe(1);
    expect(remoteRef(headsRef(s.key))).toBe(head(s));

    // the PR head is behind the approved head by norn's own commits only: no head change
    const pr = h.remote.prs.find((p) => p.head === s.branch) as (typeof h.remote.prs)[number];
    pr.head_sha = atOpenPr as string;
    await h.tick("--sync");
    expect(headItems(await inbox())).toEqual([]);
    // a person's push to the branch after the approval is one
    const c = personClone("after-ready");
    sh(c, ["fetch", "-q", "origin", s.branch]);
    sh(c, ["checkout", "-q", "-B", s.branch, `origin/${s.branch}`]);
    writeFileSync(join(c, "late.txt"), "late\n");
    sh(c, ["add", "-A"]);
    sh(c, ["commit", "-q", "-m", "a late fix"]);
    sh(c, ["push", "-q", "origin", s.branch]);
    pr.head_sha = sh(c, ["rev-parse", "HEAD"]);
    h.clock.advance(10_000);
    await h.tick("--sync");
    expect(headItems(await inbox())).toEqual([`head:${s.key}:${pr.head_sha}`]);
  });

  test("AC6: a person's push to the story branch while norn holds local boundaries is merged at open-pr, never rebased", async () => {
    const s = await atReviewWithPr(2, "person-push");
    report(s.runs, "rework");
    await tickUntil(() => state(s.runs)?.step === "implement" && state(s.runs)?.status === "running");
    const local = head(s);
    expect(remoteRef(`refs/heads/${s.branch}`)).not.toBe(local);
    // a person pushes to the PR branch
    const c = personClone("person");
    sh(c, ["fetch", "-q", "origin", s.branch]);
    sh(c, ["checkout", "-q", "-B", s.branch, `origin/${s.branch}`]);
    writeFileSync(join(c, "person.txt"), "mine\n");
    sh(c, ["add", "-A"]);
    sh(c, ["commit", "-q", "-m", "a person's fix"]);
    sh(c, ["push", "-q", "origin", s.branch]);
    const theirs = sh(c, ["rev-parse", "HEAD"]);
    report(s.runs, "done");
    await tickUntil(() => state(s.runs)?.step === "review");
    const pushed = remoteRef(`refs/heads/${s.branch}`) as string;
    for (const c of [theirs, local]) expect(sh(h.root, ["merge-base", "--is-ancestor", c, pushed])).toBe("");
    // the person's commit is kept as it was: merged, not rewritten
    expect(sh(h.root, ["rev-list", pushed]).split("\n")).toContain(theirs);
  });
});

describe("claim release and close while the PR is open", () => {
  /** A story whose PR is open with a local boundary the branch lacks (review → implement). */
  async function aheadOfPr(n: number, slug: string): Promise<{ s: Story; prHead: string | null }> {
    const s = await atReviewWithPr(n, slug);
    const prHead = remoteRef(`refs/heads/${s.branch}`);
    report(s.runs, "rework");
    await tickUntil(() => state(s.runs)?.step === "implement" && state(s.runs)?.status === "running");
    expect(head(s)).not.toBe(prHead);
    return { s, prHead };
  }

  test("AC5: story handoff puts the latest boundary on the heads ref and leaves the PR head alone", async () => {
    const { s, prHead } = await aheadOfPr(3, "handoff");
    const r = await h.norn("story", "handoff", s.key, "--json");
    expect(r.exit).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ released: true, pushed: [headsRef(s.key)] });
    expect(remoteRef(headsRef(s.key))).toBe(head(s));
    expect(remoteRef(`refs/heads/${s.branch}`)).toBe(prHead);
  });

  test("AC5: a clean watch exit does the same for every claim it releases", async () => {
    const { s, prHead } = await aheadOfPr(4, "watch-exit");
    const r = await runChecked(["watch", "--interval", "1ms", "--max-ticks", "1"], { ...h.deps, log: () => {} });
    expect(r.exit).toBe(0);
    expect(remoteRef(headsRef(s.key))).toBe(head(s));
    expect(remoteRef(`refs/heads/${s.branch}`)).toBe(prHead);
  });

  test("AC5: story close pushes the story branch first", async () => {
    const { s } = await aheadOfPr(5, "close");
    const local = head(s);
    const r = await h.norn("story", "close", s.key, "--yes", "--json");
    expect(r.exit).toBe(0);
    // the branch carries the boundary the PR lacked (close may commit its own drop on top)
    expect(sh(h.root, ["merge-base", "--is-ancestor", local, remoteRef(`refs/heads/${s.branch}`) as string])).toBe("");
  });
});
