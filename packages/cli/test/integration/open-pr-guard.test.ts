/**
 * The PR head at merge is the commit `ci` ran on, through the cli on real git: nothing pushes the
 * story branch after `ci` passes or `ready` approves, and a code change made while the story waits
 * at ready or merge goes back through open-pr (and so through `ci`) before anyone can merge it.
 * The `ci` check records the PR head it ran on, as the remote has it.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { headsRef } from "@norn/schema";
import { listReceipts, workflowsDir } from "@norn/store";
import { createHarness, type Harness, issue, sh } from "../../../../test/support/harness.ts";
import { runStateOf } from "../../../../test/support/run-state.ts";

setDefaultTimeout(120_000);

const KEY = "gh-1";
const SLUG = "gh-1-pay-invoices";
const SPEC = `.agents/specs/${SLUG}`;

let h: Harness;
const CI_LOG = () => join(h.dir, "ci.log");
const PUSH_LOG = () => join(h.dir, "received.log");

const guarded = (ciLog: string) => `name: guarded
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: open-pr, means: "built" } }
  open-pr:
    type: git
    action: open-pr
    outcomes: { done: ci }
  ci:
    type: check
    run: git ls-remote origin refs/heads/${SLUG} | cut -f1 >> ${ciLog}
    timeout: 1m
    outcomes: { pass: ready, fail: { to: implement, counter: ci_loop } }
  ready:
    type: gate
    outcomes: { approve: merge, reject: { to: implement, counter: ci_loop } }
  merge:
    type: merge
    outcomes: { stale: { to: update, counter: stale_loop } }
  update:
    type: git
    action: update
    outcomes: { done: open-pr, conflict: $stuck }
counters: { ci_loop: { max: 3 }, stale_loop: { max: 3 } }
`;

const runs = () => runStateOf(join(h.worktree(SLUG), SPEC));
const remoteRef = (ref: string): string | null => sh(h.dir, ["ls-remote", h.remoteDir, ref]).split(/\s+/)[0] || null;
const prBranch = () => remoteRef(`refs/heads/${SLUG}`);
/** the commits the `ci` check ran on, oldest first */
const ciHeads = () => (existsSync(CI_LOG()) ? readFileSync(CI_LOG(), "utf8").split("\n").filter(Boolean) : []);
/** The host reports the PR's head as the remote branch's tip, as GitHub does. */
function hostSeesBranch() {
  const pr = h.remote.prs.find((p) => p.head === SLUG);
  if (pr) pr.head_sha = prBranch() ?? "";
}
async function until(done: () => boolean, max = 14) {
  for (let i = 0; i < max && !done(); i++) {
    h.clock.advance(10_000);
    hostSeesBranch();
    await h.tick("--sync");
  }
  expect(done()).toBe(true);
}
/** Runs `n` real ticks, for what must hold while the story waits. */
async function ticks(n: number) {
  for (let i = 0; i < n; i++) {
    h.clock.advance(10_000);
    hostSeesBranch();
    await h.tick("--sync");
  }
}
function logReceived() {
  const hook = join(h.remoteDir, "hooks", "post-receive");
  writeFileSync(hook, `#!/bin/sh\nwhile read old new ref; do echo "$new $ref" >> "${PUSH_LOG()}"; done\nexit 0\n`);
  chmodSync(hook, 0o755);
  rmSync(PUSH_LOG(), { force: true });
}
const branchPushes = () => (existsSync(PUSH_LOG()) ? readFileSync(PUSH_LOG(), "utf8").split("\n").filter((l) => l.endsWith(` refs/heads/${SLUG}`)) : []);
/** A commit made in the story worktree while the story waits (a person's local fix, an agent's leftover). */
function commitInWorktree(path: string, text: string) {
  const wt = h.worktree(SLUG);
  writeFileSync(join(wt, path), text);
  sh(wt, ["add", "-A"]);
  sh(wt, ["-c", "user.email=p@example.com", "-c", "user.name=p", "commit", "-q", "-m", `edit ${path}`]);
}
const at = (step: string) => () => h.state(runs())?.step === step && h.state(runs())?.status === "parked";

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.config("provider: gh\nworkflow: guarded\nmode: auto\n");
  h.write(join(workflowsDir(h.root), "guarded.yaml"), guarded(CI_LOG()));
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(1, "Pay invoices")];
  await h.tick("--sync");
  await until(() => h.state(runs())?.status === "running");
  h.report(runs(), "done", { outcome: "done", handoff: "built" });
  await until(at("ready"));
});
afterAll(() => h.cleanup());

describe("the PR head at merge is the commit ci ran on", () => {
  test("AC3: after ci passes and ready approves, the story waits at merge with the PR head ci ran on; no branch push happened", async () => {
    expect(ciHeads().length).toBe(1);
    logReceived();
    expect((await h.norn("story", "approve", KEY)).exit).toBe(0);
    await until(at("merge"));
    await ticks(3);
    expect(h.state(runs())).toMatchObject({ step: "merge", status: "parked" });
    expect(prBranch()).toBe(ciHeads().at(-1) as string);
    expect(branchPushes()).toEqual([]);
    // the boundaries since went to the heads ref
    expect(remoteRef(headsRef(KEY))).toBe(sh(h.root, ["rev-parse", `refs/heads/${SLUG}`]));
  });

  test("AC2: a spec-folder-only change stays local; the story keeps waiting at merge", async () => {
    commitInWorktree(`${SPEC}/notes.md`, "bookkeeping\n");
    await ticks(3);
    expect(h.state(runs())).toMatchObject({ step: "merge", status: "parked" });
    expect(prBranch()).toBe(ciHeads().at(-1) as string);
    expect(branchPushes()).toEqual([]);
  });

  test("AC2: a code change the PR lacks sends the story back through open-pr and ci, with a receipt saying why", async () => {
    commitInWorktree("fix.txt", "a late fix\n");
    const local = sh(h.root, ["rev-parse", `refs/heads/${SLUG}`]);
    await until(() => h.state(runs())?.step !== "merge");
    expect(h.state(runs())?.last_outcome).toMatchObject({ step: "merge", outcome: "unpushed" });
    const why = listReceipts(runs()).receipts.map((r) => r.receipt).filter((r) => r.kind === "classify" && r.outcome === "unpushed");
    expect(why).toMatchObject([{ step: "merge", route: "open-pr", detail: "changes since open-pr are not on the PR: fix.txt" }]);
    await until(at("ready"));
    // open-pr pushed the fix, and ci ran on the head that holds it
    expect(ciHeads().length).toBe(2);
    expect(prBranch()).toBe(ciHeads().at(-1) as string);
    expect(sh(h.root, ["merge-base", "--is-ancestor", local, prBranch() as string])).toBe("");
  });
});
