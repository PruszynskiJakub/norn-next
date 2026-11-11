import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { claimRef, headsRef, recordRef, ulid } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-337-a-base-move-under-a-story-costs-a-whole/packages/schema/src/index.ts";
import { appendReceipt, readState, workflowsDir } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-337-a-base-move-under-a-story-costs-a-whole/packages/store/src/index.ts";
import type { TickReport } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-337-a-base-move-under-a-story-costs-a-whole/packages/cli/src/index.ts";
import { createHarness, type Harness, issue, sh, worktreeOf } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-337-a-base-move-under-a-story-costs-a-whole/test/support/harness.ts";
import { cloneOf } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-337-a-base-move-under-a-story-costs-a-whole/test/support/clone.ts";
import { runStateOf } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-337-a-base-move-under-a-story-costs-a-whole/test/support/run-state.ts";

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
  h.git(["add", "-A"]); h.git(["commit", "-q", "-m", "norn init"]); h.git(["push", "-q", "origin", "main"]);
});
afterAll(() => h.cleanup());
for (const policy of ["local", "remote"] as const) {
  test(`QA ${policy}: heads ref holds a boundary the branch lacks AND a person pushed to the branch: does the takeover merge both?`, async () => {
    const n = policy === "local" ? 3 : 4;
    h.config(policy === "remote" ? REMOTE : CONFIG);
    const s = await atReview(n, `div-${policy}`);
    if (policy === "remote") await tick();
    const boundary = branchLacksBoundary(s.branch, n);
    const person = join(h.dir, `person-${policy}`);
    sh(h.dir, ["clone", "-q", "-b", s.branch, h.remoteDir, person]);
    writeFileSync(join(person, "person.txt"), "theirs\n");
    sh(person, ["add", "person.txt"]);
    sh(person, ["-c", "user.name=p", "-c", "user.email=p@e.com", "commit", "-q", "-m", "person's commit"]);
    sh(person, ["push", "-q", "origin", s.branch]);
    const theirs = sh(person, ["rev-parse", "HEAD"]);
    expire(s.key);
    const B = cloneOf(h, `b-${policy}`, "bob");
    const r = await B.norn("story", "checkout", s.key, "--json");
    console.log(`QA[${policy}] checkout exit`, r.exit, JSON.stringify(r.value).slice(0, 400));
    const head = sh(s.wt(B.root), ["rev-parse", "HEAD"]);
    const has = (c: string) => { try { sh(B.root, ["merge-base", "--is-ancestor", c, head]); return true; } catch { return false; } };
    console.log(`QA[${policy}] B HEAD ${head}; contains boundary ${boundary}: ${has(boundary)}; contains person's ${theirs}: ${has(theirs)}; parents: ${sh(B.root, ["log", "-1", "--format=%P", head])}`);
    const v = r.value as { units?: Array<{ unit: string; step: string }> };
    console.log(`QA[${policy}] story step after takeover:`, v.units?.find((u) => u.unit === s.key)?.step);
    h.config(CONFIG);
  });
}
