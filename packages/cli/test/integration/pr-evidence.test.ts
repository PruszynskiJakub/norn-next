/**
 * The describe agent links QA evidence in `pr.md` by its path in the story's
 * record (`evidence/<unit>/<run_id>/<file>`); `open-pr` pushes the record to `refs/norn/runs/<story>`
 * (under `local` too), rewrites each such link to that record commit's URL, then opens or updates the
 * PR. A link the record does not hold is left as written and named; a rejected record push fails the
 * git step before any PR call; after rework the new record commit's parent is the earlier one.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RemotePullRequest } from "@norn/core";
import { recordRef } from "@norn/schema";
import { listReceipts, workflowsDir } from "@norn/store";
import type { CliResult } from "../../src/index.ts";
import { createHarness, type Harness, issue, runChecked, sh } from "../../../../test/support/harness.ts";
import { runStateOf } from "../../../../test/support/run-state.ts";

setDefaultTimeout(90_000);

const SHIP = `name: ship
start: qa
steps:
  qa:
    type: agent
    skill: norn-qa
    outcomes: { pass: { to: describe, means: "every criterion observed" } }
  describe:
    type: agent
    skill: norn-pr
    inputs: [spec, diff, record]
    outcomes: { done: { to: open-pr, means: "PR body written" } }
  open-pr:
    type: git
    action: open-pr
    outcomes: { done: ready }
  ready:
    type: gate
    outcomes: { approve: $done, reject: { to: qa, counter: loop } }
counters: { loop: { max: 3 } }
`;
// no record.policy: the default `local` — open-pr pushes the record all the same
const CONFIG = "provider: gh\nworkflow: ship\nmode: manual\n";

let h: Harness;
const spec = ".agents/specs/gh-7-count-items";
const wt = () => h.worktree("gh-7-count-items");
const runs = () => runStateOf(join(wt(), spec));
const tick = () => {
  h.clock.advance(10_000);
  return h.tick();
};
const inWt = (...argv: string[]): Promise<CliResult> => {
  const env: Record<string, string | undefined> = { ...h.deps.env, NORN_AGENT_PID: String(process.pid) };
  for (const k of ["NORN_AGENT", "NORN_RUN", "NORN_STORY", "NORN_SLICE", "NORN_AGENT_SESSION_ID"]) delete env[k];
  return runChecked(argv, { ...h.deps, cwd: wt(), env });
};
async function tickUntil(pred: () => boolean, max = 12) {
  for (let i = 0; i < max && !pred(); i++) await tick();
  expect(pred()).toBe(true);
}
const remoteRecord = (): string | null => sh(h.dir, ["ls-remote", h.remoteDir, recordRef("gh-7")]).split(/\s+/)[0] || null;
const remoteFiles = (sha: string): string[] => sh(h.dir, ["--git-dir", h.remoteDir, "ls-tree", "-r", "--name-only", sha]).split("\n").filter(Boolean);
const remoteParents = (sha: string): string[] => sh(h.dir, ["--git-dir", h.remoteDir, "log", "-1", "--format=%P", sha]).split(" ").filter(Boolean);
const body = (): string => h.remote.bodies.get(h.remote.prs[0]?.number ?? -1) ?? "";
const scratch: string[] = [];

/** The qa step reports `pass` with one screenshot as evidence; returns the qa run's id. */
async function qaWithEvidence(): Promise<string> {
  expect((await inWt("brief")).exit).toBe(0);
  await tick();
  const dir = mkdtempSync(join(tmpdir(), "norn-evidence-"));
  scratch.push(dir);
  writeFileSync(join(dir, "shot.png"), `png ${Date.now()} ${Math.random()}`);
  expect((await inWt("done", "pass", "--handoff", "observed", "--evidence", dir)).exit).toBe(0);
  const done = listReceipts(runs()).receipts.findLast((r) => r.receipt.kind === "done" && r.receipt.step === "qa")?.receipt;
  const ev = done?.kind === "done" ? done.evidence : undefined;
  expect(ev).toMatch(/^evidence\//);
  await tickUntil(() => h.state(runs())?.step === "describe");
  return (ev as string).slice("evidence/".length);
}

/** The describe step writes `pr.md` and reports; returns its brief's JSON. */
async function describeWith(prMd: string) {
  const b = await inWt("brief", "--json");
  expect(b.exit).toBe(0);
  await tick();
  h.write(join(wt(), spec, "pr.md"), prMd);
  expect((await inWt("done", "done", "--handoff", "described")).exit).toBe(0);
  return (b.value as { brief: { inputs: Array<{ kind: string; label: string; ref: string }> } }).brief;
}

const openPrDetail = (): string => {
  const r = listReceipts(runs()).receipts.findLast((x) => x.receipt.kind === "classify" && x.receipt.step === "open-pr")?.receipt;
  return r?.kind === "classify" ? (r.detail ?? "") : "";
};

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.config(CONFIG);
  h.write(join(workflowsDir(h.root), "ship.yaml"), SHIP);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(7, "Count items")];
  await tickUntil(() => h.state(runs())?.step === "qa");
});
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
  h.cleanup();
});

describe("PR evidence links to the story's record (B28, D5)", () => {
  let first: { sha: string; run: string };

  test("AC1, AC2, AC4: the record is pushed before the PR opens, record links rewritten to it, a missing one left as written and named", async () => {
    const run = await qaWithEvidence();
    const brief = await describeWith(`## Evidence\n\n![B2 after](evidence/_story/${run}/shot.png)\n\n![gone](evidence/_story/NOPE/gone.png)\n`);
    // The `record` input lists the story's receipts and evidence folders in the machine dir
    const record = brief.inputs.filter((i) => i.kind === "record");
    expect(record.map((i) => i.ref)).toEqual([`${runs()}/receipts/`, `${runs()}/evidence/`]);
    expect(record[1]?.label).toContain("evidence/_story/<run_id>/<file>");
    expect(remoteRecord()).toBeNull();

    // The record ref is on the remote when the PR is opened
    let atOpen: string | null | undefined;
    const open = h.remote.openDraftPullRequest.bind(h.remote);
    h.remote.openDraftPullRequest = async (o): Promise<RemotePullRequest> => {
      atOpen = remoteRecord();
      return open(o);
    };
    await tickUntil(() => h.state(runs())?.step === "ready");
    const sha = remoteRecord();
    expect(sha).not.toBeNull();
    expect(atOpen).toBe(sha);
    const path = `_story/rounds/01-ship/evidence/${run}/shot.png`;
    expect(remoteFiles(sha as string)).toContain(path);
    expect(body()).toContain(`![B2 after](https://github.com/o/r/blob/${sha}/${path}?raw=true)`);
    // A link to a file the record does not hold is left as written and named in the step's output
    expect(body()).toContain("![gone](evidence/_story/NOPE/gone.png)");
    expect(openPrDetail()).toContain("evidence/_story/NOPE/gone.png");
    first = { sha: sha as string, run };
  });

  test("AC2, AC3: a rejected record push fails open-pr before any PR call; once accepted, a new record commit on the earlier one, links rewritten to it", async () => {
    expect((await h.norn("story", "reject", "gh-7", "--reason", "show the empty case")).exit).toBe(0);
    await tickUntil(() => h.state(runs())?.step === "qa");
    const run = await qaWithEvidence();
    await describeWith(`## Evidence\n\n![B2 empty](evidence/_story/${run}/shot.png)\n\n![B2 after](evidence/_story/${first.run}/shot.png)\n`);

    const hook = join(h.remoteDir, "hooks", "pre-receive");
    writeFileSync(hook, `#!/bin/sh\nwhile read old new ref; do\n  case "$ref" in refs/norn/runs/gh-7) echo "record refused" >&2; exit 1;; esac\ndone\nexit 0\n`);
    chmodSync(hook, 0o755);
    const calls = h.remote.calls.length;
    try {
      await tick(); // apply → open-pr
      const r = await tick(); // open-pr: the record push is refused
      const git = r.decisions.filter((d) => d.unit === "gh-7" && d.kind === "run_git");
      expect(git.map((d) => d.ok)).toEqual([false]);
      expect(git[0]?.error).toContain(recordRef("gh-7"));
      expect(h.state(runs())?.step).toBe("open-pr");
      expect(h.remote.calls.slice(calls).filter((c) => c.startsWith("pr+") || c.startsWith("pr~"))).toEqual([]);
      expect(remoteRecord()).toBe(first.sha);
    } finally {
      rmSync(hook, { force: true });
    }
    // retried as git steps are: the next tick pushes the record and updates the open PR
    await tickUntil(() => h.state(runs())?.step === "ready");
    const sha = remoteRecord() as string;
    expect(sha).not.toBe(first.sha);
    expect(remoteParents(sha)).toEqual([first.sha]);
    expect(h.remote.prs).toHaveLength(1);
    expect(body()).toContain(`![B2 empty](https://github.com/o/r/blob/${sha}/_story/rounds/01-ship/evidence/${run}/shot.png?raw=true)`);
    expect(body()).toContain(`![B2 after](https://github.com/o/r/blob/${sha}/_story/rounds/01-ship/evidence/${first.run}/shot.png?raw=true)`);
    // the older body's links still resolve: its commit is the new one's parent, on the remote
    expect(remoteFiles(first.sha)).toContain(`_story/rounds/01-ship/evidence/${first.run}/shot.png`);
  });

  test("under remote, the tick whose open-pr pushes an owed record decides no second record push beside it", async () => {
    h.config(`${CONFIG}record:\n  policy: remote\n`);
    expect((await h.norn("story", "reject", "gh-7", "--reason", "once more")).exit).toBe(0);
    await tickUntil(() => h.state(runs())?.step === "qa");
    const run = await qaWithEvidence();
    await describeWith(`![B2](evidence/_story/${run}/shot.png)\n`);
    // the record is owed when open-pr runs: every push of it refused until then
    const hook = join(h.remoteDir, "hooks", "pre-receive");
    writeFileSync(hook, `#!/bin/sh\nwhile read old new ref; do\n  case "$ref" in refs/norn/runs/gh-7) echo "record refused" >&2; exit 1;; esac\ndone\nexit 0\n`);
    chmodSync(hook, 0o755);
    try {
      await tickUntil(() => h.state(runs())?.step === "open-pr");
      await tick(); // open-pr refused
      expect(h.state(runs())?.step).toBe("open-pr");
    } finally {
      rmSync(hook, { force: true });
    }
    const r = await tick();
    expect(r.decisions.filter((d) => d.unit === "gh-7").map((d) => [d.kind, d.ok])).toContainEqual(["run_git", true]);
    expect(r.decisions.filter((d) => d.kind === "push_record")).toEqual([]);
    const sha = remoteRecord();
    expect(body()).toContain(`https://github.com/o/r/blob/${sha}/_story/rounds/01-ship/evidence/${run}/shot.png?raw=true`);
  });
});
