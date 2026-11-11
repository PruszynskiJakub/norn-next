/**
 * The story's heads ref `refs/norn/heads/<story>`: every push of the story branch carries it in the
 * same push, under either record policy, so the story's real last boundary is on the remote; the
 * record names it; a takeover after a crash resumes from it, merged with the remote branch (never
 * rebased); it goes when the story ends (`story close`, `norn tidy`). Two clones of one bare remote,
 * what the remote received logged by a real `post-receive` hook (one `--` line per push).
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { claimRef, headsRef, recordRef, ulid } from "@norn/schema";
import { appendReceipt, readState, workflowsDir } from "@norn/store";
import type { TickReport } from "../../src/index.ts";
import { createHarness, type Harness, issue, sh, worktreeOf } from "../../../../test/support/harness.ts";
import { cloneOf } from "../../../../test/support/clone.ts";
import { runStateOf } from "../../../../test/support/run-state.ts";

setDefaultTimeout(120_000);

const RV = `name: rv
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: review, means: "built" } }
  review:
    type: agent
    skill: norn-review
    outcomes:
      approve: { to: $done, means: "good" }
      rework: { to: implement, counter: review_loop, means: "fix it" }
counters: { review_loop: { max: 3 } }
`;
// the PR opens before review, so a rework boundary moves the heads ref alone
const PR = `name: pr
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: open-pr, means: "built" } }
  open-pr:
    type: git
    action: open-pr
    outcomes: { done: review }
  review:
    type: agent
    skill: norn-review
    outcomes:
      approve: { to: $done, means: "good" }
      rework: { to: implement, counter: review_loop, means: "fix it" }
counters: { review_loop: { max: 3 } }
`;
const CONFIG = "provider: gh\nworkflow: rv\nmode: auto\n";
const REMOTE = `${CONFIG}record:\n  policy: remote\n`;

let h: Harness;

const state = (dir: string) => {
  const r = readState(dir);
  return r.ok ? r.value : null;
};
const tick = (): Promise<TickReport> => {
  h.clock.advance(10_000);
  return h.tick();
};
async function tickUntil(pred: () => boolean, max = 12) {
  for (let i = 0; i < max && !pred(); i++) await tick();
  expect(pred()).toBe(true);
}
function report(runsDir: string, outcome: string) {
  const st = state(runsDir);
  if (!st) throw new Error(`no state in ${runsDir}`);
  appendReceipt(runsDir, { kind: "done", receipt_id: ulid(h.clock.now()), run_id: st.run?.run_id ?? null, step: st.step, attempt: st.attempt, at: h.clock.iso(), by: "agent", outcome, handoff: `${st.step} ${outcome}` } as never);
}
const remoteRef = (ref: string): string | null => sh(h.dir, ["ls-remote", h.remoteDir, ref]).split(/\s+/)[0] || null;
const remoteGit = (...args: string[]) => sh(h.dir, ["--git-dir", h.remoteDir, ...args]);

// the remote logs every ref update it accepts as `<new sha> <ref>`, and `--` after each push
const LOG = () => join(h.dir, "received.log");
function logReceived() {
  const hook = join(h.remoteDir, "hooks", "post-receive");
  writeFileSync(hook, `#!/bin/sh\nwhile read old new ref; do echo "$new $ref" >> "${LOG()}"; done\necho -- >> "${LOG()}"\nexit 0\n`);
  chmodSync(hook, 0o755);
  rmSync(LOG(), { force: true });
}
/** each push the remote took, as the refs it updated */
function pushes(): string[][] {
  const out: string[][] = [[]];
  for (const l of existsSync(LOG()) ? readFileSync(LOG(), "utf8").split("\n").filter(Boolean) : []) {
    if (l === "--") out.push([]);
    else out[out.length - 1]?.push(l.split(" ")[1] as string);
  }
  return out.filter((p) => p.length);
}

/** A story clone A runs to review (the boundary implement.done → review pushed). */
async function atReview(n: number, slug: string) {
  const key = `gh-${n}`;
  const spec = `.agents/specs/${key}-${slug}`;
  const branch = `${key}-${slug}`;
  const wt = (root: string) => worktreeOf(root, branch);
  const runs = (root: string) => runStateOf(join(wt(root), spec));
  h.remote.issues = [...h.remote.issues, issue(n, slug, ["norn", "norn:wf:rv"])];
  await h.tick("--sync");
  await tickUntil(() => state(runs(h.root))?.status === "running");
  report(runs(h.root), "done");
  await tickUntil(() => state(runs(h.root))?.step === "review" && state(runs(h.root))?.status === "running");
  return { key, spec, branch, wt, runs };
}

/** Let A's claim on `key` expire (A stopped ticking). */
function expire(key: string) {
  const blob = JSON.parse(sh(h.root, ["cat-file", "-p", claimRef(key)])) as { expires_at: string };
  h.clock.t = Math.max(h.clock.t, Date.parse(blob.expires_at) + 60_000);
}

/**
 * A crash after a boundary the remote branch lacks: the branch on the remote is put back to the
 * boundary's parent while the heads ref keeps the boundary. Returns the heads ref commit.
 */
function branchLacksBoundary(branch: string, n: number): string {
  const boundary = remoteRef(`refs/heads/${branch}`) as string;
  expect(remoteRef(headsRef(`gh-${n}`))).toBe(boundary);
  sh(h.root, ["push", "-q", "-f", "origin", `${boundary}~1:refs/heads/${branch}`]);
  return boundary;
}

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.config(CONFIG);
  h.write(join(workflowsDir(h.root), "rv.yaml"), RV);
  h.write(join(workflowsDir(h.root), "pr.yaml"), PR);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
});
afterAll(() => h.cleanup());

describe("every boundary puts the story's head on its heads ref", () => {
  test("AC1: no PR yet: the boundary pushes the story branch as today and the heads ref at the same commit, in one push", async () => {
    logReceived();
    const s = await atReview(1, "one-push");
    const head = sh(h.root, ["rev-parse", `refs/heads/${s.branch}`]);
    expect(remoteRef(`refs/heads/${s.branch}`)).toBe(head);
    expect(remoteRef(headsRef(s.key))).toBe(head);
    const branchPushes = pushes().filter((p) => p.includes(`refs/heads/${s.branch}`));
    expect(branchPushes.length).toBeGreaterThan(0);
    for (const p of branchPushes) expect(p).toContain(headsRef(s.key));
    expect(pushes().filter((p) => p.includes(headsRef(s.key)) && !p.includes(`refs/heads/${s.branch}`))).toEqual([]);
  });

  test("AC2: record.policy remote: the record ref is pushed after the heads ref and names its commit", async () => {
    h.config(REMOTE);
    try {
      logReceived();
      const s = await atReview(2, "remote-record");
      await tick();
      const rec = remoteRef(recordRef(s.key)) as string;
      expect(rec).toBeTruthy();
      const heads = remoteRef(headsRef(s.key));
      expect(remoteGit("log", "-1", "--format=%(trailers:key=Norn-Branch-Commit,valueonly)", rec).trim()).toBe(heads as string);
      const refs = pushes().flat();
      expect(refs.indexOf(headsRef(s.key))).toBeGreaterThanOrEqual(0);
      expect(refs.lastIndexOf(recordRef(s.key))).toBeGreaterThan(refs.indexOf(headsRef(s.key)));
    } finally {
      h.config(CONFIG);
    }
  });
});

describe("a takeover after a crash resumes from the heads ref", () => {
  for (const policy of ["local", "remote"] as const) {
    test(`AC3: record.policy ${policy}: B's story worktree resumes at the heads ref, the boundary the remote branch lacks`, async () => {
      const n = policy === "local" ? 3 : 4;
      h.config(policy === "remote" ? REMOTE : CONFIG);
      try {
        const s = await atReview(n, `crash-${policy}`);
        if (policy === "remote") await tick();
        const boundary = branchLacksBoundary(s.branch, n);
        expire(s.key);
        const B = cloneOf(h, `b-${policy}`, "bob");
        const r = await B.norn("story", "checkout", s.key, "--json");
        expect(r.exit).toBe(0);
        // the worktree is at the heads ref: the boundary itself, nothing rebased
        expect(sh(s.wt(B.root), ["rev-parse", "HEAD"])).toBe(boundary);
        // the story resumes at review: the real last boundary (implement.done → review), not the one the branch shows
        const v = r.value as { units: Array<{ unit: string; step: string }>; restarted?: string };
        expect(v.units.find((u) => u.unit === s.key)?.step).toBe("review");
        if (policy === "remote") expect(v.restarted).toBeUndefined();
      } finally {
        h.config(CONFIG);
      }
    });
    test(`AC3: record.policy ${policy}: with the PR open, a person pushed to its branch: B's worktree merges the heads ref and the branch, never rebased`, async () => {
      const n = policy === "local" ? 9 : 10;
      h.config(policy === "remote" ? REMOTE : CONFIG);
      try {
        const s = await headsAheadOfPr(n, `diverged-${policy}`);
        const theirs = personPushes(s.branch, `person-${policy}`, "person.txt", "theirs\n");
        expire(s.key);
        const B = cloneOf(h, `b-diverged-${policy}`, "bob");
        const r = await B.norn("story", "checkout", s.key, "--json");
        expect(r.exit).toBe(0);
        const head = sh(s.wt(B.root), ["rev-parse", "HEAD"]);
        // a merge of the boundary and the person's commit, each kept as it was
        expect(sh(B.root, ["log", "-1", "--format=%P", head]).split(" ")).toEqual([s.boundary, theirs]);
        const v = r.value as { units: Array<{ unit: string; step: string }> };
        // local: the step the last record push left (open-pr opened the PR); remote: the real last boundary
        expect(v.units.find((u) => u.unit === s.key)?.step).toBe(policy === "remote" ? "implement" : "open-pr");
      } finally {
        h.config(CONFIG);
      }
    });
  }
  test("AC3: with the PR open, a person's push that clashes with the boundary the heads ref holds: the takeover is refused and nothing is taken", async () => {
    const s = await headsAheadOfPr(11, "diverged-clash", (wt) => {
      writeFileSync(join(wt, "clash.txt"), "mine\n");
      sh(wt, ["add", "clash.txt"]);
      sh(wt, ["commit", "-q", "-m", "agent's edit"]);
    });
    personPushes(s.branch, "person-clash", "clash.txt", "theirs\n");
    expire(s.key);
    const claim = remoteRef(claimRef(s.key));
    const B = cloneOf(h, "b-diverged-clash", "bob");
    const r = await B.norn("story", "checkout", s.key, "--json");
    expect(r.exit).not.toBe(0);
    expect((r.value as { code?: string }).code).toBe("branch_diverged");
    expect(remoteRef(claimRef(s.key))).toBe(claim);
  });
  test("AC3: with no PR open, a branch that diverged from the heads ref was rewritten: B takes the branch as it is", async () => {
    const s = await atReview(12, "rewritten-no-pr");
    const boundary = branchLacksBoundary(s.branch, 12);
    const theirs = personPushes(s.branch, "person-rewrite", "person.txt", "theirs\n");
    expire(s.key);
    const B = cloneOf(h, "b-rewritten-no-pr", "bob");
    const r = await B.norn("story", "checkout", s.key, "--json");
    expect(r.exit).toBe(0);
    expect(sh(s.wt(B.root), ["rev-parse", "HEAD"])).toBe(theirs);
    expect(() => sh(B.root, ["merge-base", "--is-ancestor", boundary, theirs])).toThrow();
  });
});

/**
 * A story on the `pr` workflow whose PR opened, then review reworked it: the boundary review → implement
 * is on the heads ref only, the PR branch behind it. `inReview` runs in A's worktree before the rework.
 */
async function headsAheadOfPr(n: number, slug: string, inReview?: (wt: string) => void) {
  const key = `gh-${n}`;
  const spec = `.agents/specs/${key}-${slug}`;
  const branch = `${key}-${slug}`;
  const wt = (root: string) => worktreeOf(root, branch);
  const runs = () => runStateOf(join(wt(h.root), spec));
  h.remote.issues = [...h.remote.issues, issue(n, slug, ["norn", "norn:wf:pr"])];
  await h.tick("--sync");
  await tickUntil(() => state(runs())?.status === "running");
  report(runs(), "done");
  await tickUntil(() => state(runs())?.step === "review" && state(runs())?.status === "running");
  expect(h.remote.prs.find((p) => p.head === branch)?.state).toBe("open");
  inReview?.(wt(h.root));
  report(runs(), "rework");
  await tickUntil(() => state(runs())?.step === "implement" && state(runs())?.status === "running");
  const boundary = remoteRef(headsRef(key)) as string;
  expect(remoteRef(`refs/heads/${branch}`)).not.toBe(boundary);
  sh(h.root, ["merge-base", "--is-ancestor", remoteRef(`refs/heads/${branch}`) as string, boundary]);
  return { key, spec, branch, wt, boundary };
}

/** A person pushes one commit writing `file` onto the story branch on the remote; its sha. */
function personPushes(branch: string, dir: string, file: string, text: string): string {
  const person = join(h.dir, dir);
  sh(h.dir, ["clone", "-q", "-b", branch, h.remoteDir, person]);
  mkdirSync(dirname(join(person, file)), { recursive: true });
  writeFileSync(join(person, file), text);
  sh(person, ["add", file]);
  sh(person, ["-c", "user.name=person", "-c", "user.email=person@example.com", "commit", "-q", "-m", "person's commit"]);
  sh(person, ["push", "-q", "origin", branch]);
  return sh(person, ["rev-parse", "HEAD"]);
}

describe("a rejected push never moves the heads ref alone", () => {
  test("AC1/AC3: a person pushed a clashing commit, the take-in fails: the heads ref stays where the branch was, and a takeover after a crash drops nothing the remote held", async () => {
    const n = 7;
    const slug = "rejected-push";
    const key = `gh-${n}`;
    const spec = `.agents/specs/${key}-${slug}`;
    const branch = `${key}-${slug}`;
    const runs = () => runStateOf(join(worktreeOf(h.root, branch), spec));
    h.remote.issues = [...h.remote.issues, issue(n, slug, ["norn", "norn:wf:rv"])];
    await h.tick("--sync");
    await tickUntil(() => state(runs())?.status === "running");
    const before = remoteRef(headsRef(key)) as string;
    expect(remoteRef(`refs/heads/${branch}`)).toBe(before);
    // a person pushes a commit to the story branch that clashes with the agent's work
    const person = join(h.dir, "person-rejected");
    sh(h.dir, ["clone", "-q", "-b", branch, h.remoteDir, person]);
    writeFileSync(join(person, "clash.txt"), "theirs\n");
    sh(person, ["add", "clash.txt"]);
    sh(person, ["-c", "user.name=person", "-c", "user.email=person@example.com", "commit", "-q", "-m", "person's edit"]);
    sh(person, ["push", "-q", "origin", branch]);
    const theirs = sh(person, ["rev-parse", "HEAD"]);
    const wt = worktreeOf(h.root, branch);
    writeFileSync(join(wt, "clash.txt"), "mine\n");
    sh(wt, ["add", "clash.txt"]);
    sh(wt, ["commit", "-q", "-m", "agent's edit"]);
    report(runs(), "done");
    await tick();
    await tick();
    // the boundary push was rejected and the merge clashed: neither ref took the boundary
    expect(remoteRef(`refs/heads/${branch}`)).toBe(theirs);
    expect(remoteRef(headsRef(key))).toBe(before);
    // A crashes; B takes over from what the remote holds: the person's commit, the heads ref inside it
    expire(key);
    const B = cloneOf(h, "b-rejected", "bob");
    const r = await B.norn("story", "checkout", key, "--json");
    expect(r.exit).toBe(0);
    expect(sh(worktreeOf(B.root, branch), ["rev-parse", "HEAD"])).toBe(theirs);
    // throws unless the heads ref is inside the branch B took
    sh(B.root, ["merge-base", "--is-ancestor", before, theirs]);
  });
});

describe("the heads ref goes when the story ends", () => {
  test("AC4: story close removes the story's heads ref from the remote", async () => {
    const s = await atReview(5, "close-heads");
    expect(remoteRef(headsRef(s.key))).toBeTruthy();
    const r = await h.norn("story", "close", s.key, "--yes", "--json");
    expect(r.exit).toBe(0);
    expect(remoteRef(headsRef(s.key))).toBeNull();
    expect(remoteRef(`refs/heads/${s.branch}`)).toBeTruthy();
  });

  test("AC4: norn tidy removes a heads ref a dropped story left on the remote", async () => {
    const s = await atReview(6, "tidy-heads");
    const r = await h.norn("story", "close", s.key, "--yes");
    expect(r.exit).toBe(0);
    // the close's delete was lost: the ref is back on the remote
    const sha = remoteRef(`refs/heads/${s.branch}`) as string;
    sh(h.root, ["push", "-q", "origin", `${sha}:${headsRef(s.key)}`]);
    expect(remoteRef(headsRef(s.key))).toBe(sha);
    const t = await h.norn("tidy", "--json");
    expect(t.exit).toBe(0);
    expect((t.value as { removed: { heads_refs?: string[] } }).removed.heads_refs).toEqual([headsRef(s.key)]);
    expect(remoteRef(headsRef(s.key))).toBeNull();
  });
});
