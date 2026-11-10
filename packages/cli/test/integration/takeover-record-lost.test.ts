/**
 * A takeover with no record. A holder that left no `refs/norn/runs/<story>`
 * (a `local` holder that died or went offline, its claim expired or taken with `--force`) — or a holder
 * whose own machine dir was wiped — is taken over from the branch alone: `story checkout` starts a new
 * round of the frontmatter's workflow, pinned fresh from the branch, at the step the story's last
 * commits on the branch name (the workflow's first step when there are none), attempt 1 and counters at
 * zero; the `take` receipt says `record_lost`, and the next brief tells the agent to check the branch
 * for what is already done. Two clones of one bare remote (seam S1).
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { claimRef, recordRef, ulid } from "@norn/schema";
import { appendReceipt, readState, workflowsDir } from "@norn/store";
import type { TickReport } from "../../src/index.ts";
import { createHarness, type Harness, issue, sh, worktreeOf } from "../../../../test/support/harness.ts";
import { type Clone, cloneOf } from "../../../../test/support/clone.ts";
import { runStateOf, storyRunStateOf } from "../../../../test/support/run-state.ts";

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
const receiptsOf = (runs: string, kind: string) =>
  (existsSync(join(runs, "receipts")) ? readdirSync(join(runs, "receipts")) : [])
    .filter((f) => f.endsWith(`-${kind}.json`))
    .map((f) => JSON.parse(readFileSync(join(runs, "receipts", f), "utf8")) as Record<string, unknown>);

interface Held {
  key: string;
  spec: string;
  branch: string;
  wt: (root: string) => string;
  runs: (root: string) => string;
}

/** A story clone A runs (rv) — `rounds` review reworks deep, at implement — then A goes silent; returns when its claim expires. */
async function heldThenSilent(n: number, slug: string, rounds: number): Promise<Held> {
  const key = `gh-${n}`;
  const spec = `.agents/specs/${key}-${slug}`;
  const branch = `${key}-${slug}`;
  const wt = (root: string) => worktreeOf(root, branch);
  const runs = (root: string) => runStateOf(join(wt(root), spec));
  h.remote.issues = [...h.remote.issues, issue(n, slug, ["norn", "norn:wf:rv"])];
  await h.tick("--sync");
  await tickUntil(() => state(runs(h.root))?.status === "running");
  for (let i = 0; i < rounds; i++) {
    report(runs(h.root), "done");
    await tickUntil(() => state(runs(h.root))?.step === "review" && state(runs(h.root))?.status === "running");
    report(runs(h.root), "rework");
    await tickUntil(() => state(runs(h.root))?.step === "implement" && state(runs(h.root))?.status === "running");
  }
  expect(state(runs(h.root))).toMatchObject({ step: "implement", attempt: rounds + 1, counters: { review_loop: rounds } });
  // `local`: A never pushed a record
  expect(remoteRef(recordRef(key))).toBeNull();
  return { key, spec, branch, wt, runs };
}

/** Let A's claim on `key` expire (A stopped ticking). */
function expire(key: string) {
  const blob = JSON.parse(sh(h.root, ["cat-file", "-p", claimRef(key)])) as { expires_at: string };
  h.clock.t = Math.max(h.clock.t, Date.parse(blob.expires_at) + 60_000);
}

function withHarness() {
  beforeAll(async () => {
    h = await createHarness();
    expect((await h.norn("init")).exit).toBe(0);
    h.config(CONFIG);
    h.write(join(workflowsDir(h.root), "rv.yaml"), RV);
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "norn init"]);
    h.git(["push", "-q", "origin", "main"]);
  });
  afterAll(() => h.cleanup());
}

type CheckoutValue = { record: unknown; record_lost?: boolean; restarted?: string; receipt: { file: string | null }; units: Array<{ unit: string; step: string; handoff: string | null }> };

describe("checkout with the record lost starts a new round from the branch (B25, D10)", () => {
  withHarness();

  test("AC1, AC2: A died at implement#2 under local; after expiry B's checkout restarts implement as a fresh round, the take says record_lost, the brief says to check the branch", async () => {
    const s = await heldThenSilent(9, "parser", 1);
    // the branch's workflow changed since A pinned it: the new round pins the branch's
    const fresh = RV.replace('means: "built"', 'means: "built and committed"');
    h.write(join(workflowsDir(s.wt(h.root)), "rv.yaml"), fresh);
    sh(s.wt(h.root), ["add", "-A"]);
    sh(s.wt(h.root), ["commit", "-q", "-m", "tune rv"]);
    sh(s.wt(h.root), ["push", "-q", "origin", s.branch]);
    expire(s.key);

    const B = cloneOf(h, "b-ac1", "bob");
    const r = await B.norn("story", "checkout", s.key);
    expect(r.exit).toBe(0);
    const v = r.value as CheckoutValue;
    const line = `the run record of ${s.key} was on tester@box and is lost; restarting implement from the branch`;
    expect(v).toMatchObject({ claim: { holder: "bob@b-ac1" }, record: null, record_lost: true, restarted: line });
    expect(v.units.find((u) => u.unit === s.key)).toMatchObject({ step: "implement" });

    // a new round: the frontmatter's workflow pinned from the branch, attempt 1, counters at zero
    const st = state(s.runs(B.root));
    expect(st).toMatchObject({ workflow: "rv", step: "implement", attempt: 1, status: "ready", counters: { review_loop: 0 }, visits: { implement: 1 } });
    expect(readFileSync(join(s.runs(B.root), "workflow.yaml"), "utf8")).toBe(fresh);
    const takes = receiptsOf(s.runs(B.root), "take");
    expect(takes).toHaveLength(1);
    expect(takes[0]).toMatchObject({ kind: "take", step: "implement", attempt: 1, previous_holder: "tester@box", expired: true, record_lost: true });

    h.clock.advance(10_000);
    const t = await B.tick();
    expect(t.decisions.filter((d) => d.unit === s.key && d.kind !== "noop" && d.rule !== "claim.renew").map((d) => `${d.kind}${d.ok ? "" : " FAILED"}`)).toEqual(["apply_receipts"]);
    // B runs in manual mode (its own local config): the step waits for a person to start it
    h.clock.advance(10_000);
    await B.tick();
    expect(state(s.runs(B.root))).toMatchObject({ step: "implement", attempt: 1, status: "ready", counters: { review_loop: 0 } });

    // The brief says the record was lost and to check the branch first
    const brief = await B.at(s.wt(B.root), "brief");
    expect(brief.exit).toBe(0);
    const from = brief.stdout.indexOf("## Why this attempt");
    const why = brief.stdout.slice(from, brief.stdout.indexOf("\n## ", from + 1));
    expect(why.toLowerCase()).toContain(line);
    expect(why).toContain("check the branch");
    const json = await B.at(s.wt(B.root), "brief", "--json");
    expect(json.value).toMatchObject({ brief: { where: { step: "implement", attempt: 1 }, history: { record_lost: { holder: "tester@box", line } } } });

    // run list shows the new round
    const list = await B.norn("run", "list", s.key, "--json");
    expect(list.exit).toBe(0);
    const steps = (list.value as { steps: Array<{ step: string; attempt: number }> }).steps;
    expect(steps.map((x) => `${x.step}#${x.attempt}`)).toEqual(["implement#1"]);
  });

  test("AC2: a takeover from a ref says record_lost false", async () => {
    const s = await heldThenSilent(10, "handed", 0);
    expect((await h.norn("story", "handoff", s.key)).exit).toBe(0);
    const B = cloneOf(h, "b-ac2", "bob");
    h.clock.advance(10_000);
    const r = await B.norn("story", "checkout", s.key);
    expect(r.exit).toBe(0);
    expect((r.value as CheckoutValue).record_lost).toBe(false);
    expect(receiptsOf(s.runs(B.root), "take")).toEqual([expect.objectContaining({ record_lost: false })]);
  });

  test("AC3: with no boundary commit on the branch, the round starts at the workflow's first step", async () => {
    const s = await heldThenSilent(11, "first", 0);
    const trailers = sh(h.root, ["log", "--format=%(trailers:key=Norn-Outcome,valueonly)", `refs/remotes/origin/${s.branch}`]).trim();
    expect(trailers).toBe("");
    expire(s.key);
    const B = cloneOf(h, "b-ac3", "bob");
    const r = await B.norn("story", "checkout", s.key);
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ record_lost: true, restarted: `the run record of ${s.key} was on tester@box and is lost; restarting implement from the branch` });
    expect(state(s.runs(B.root))).toMatchObject({ step: "implement", attempt: 1, counters: { review_loop: 0 } });
  });

  test("F1: A died at review (last boundary implement.done → review): B restarts review, not the workflow's first step", async () => {
    const s = await heldThenSilent(15, "at-review", 0);
    report(s.runs(h.root), "done");
    await tickUntil(() => state(s.runs(h.root))?.step === "review" && state(s.runs(h.root))?.status === "running");
    const next = sh(h.root, ["log", "-1", "--format=%(trailers:key=Norn-Next,valueonly)", "--grep=^Norn-Outcome: ", `refs/remotes/origin/${s.branch}`]).trim();
    expect(next).toBe("review");
    expire(s.key);
    const B = cloneOf(h, "b-review", "bob");
    const r = await B.norn("story", "checkout", s.key);
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ record_lost: true, restarted: `the run record of ${s.key} was on tester@box and is lost; restarting review from the branch` });
    expect(state(s.runs(B.root))).toMatchObject({ step: "review", attempt: 1, visits: { review: 1 }, counters: { review_loop: 0 } });
    expect(receiptsOf(s.runs(B.root), "take")).toEqual([expect.objectContaining({ step: "review", attempt: 1, record_lost: true })]);
  });

  test("a live claim is still refused without --force; with --force the take is forced and the record lost", async () => {
    const s = await heldThenSilent(12, "forced", 1);
    const B = cloneOf(h, "b-force", "bob");
    h.clock.advance(10_000);
    const refused = await B.norn("story", "checkout", s.key);
    expect(refused.exit).not.toBe(0);
    expect(existsSync(storyRunStateOf(join(B.root, s.spec)))).toBe(false);
    const r = await B.norn("story", "checkout", s.key, "--force");
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ forced: true, record_lost: true });
    expect(receiptsOf(s.runs(B.root), "take")).toEqual([expect.objectContaining({ forced: true, expired: false, record_lost: true, step: "implement", attempt: 1 })]);
  });
});

describe("a wiped machine dir on the holder recovers as any takeover (B26)", () => {
  withHarness();

  /** Delete clone `root`'s norn home (`~/.norn`) and leave it empty. */
  const wipe = (home: string) => {
    rmSync(home, { recursive: true, force: true });
    mkdirSync(home);
  };

  test("AC4: no ref: A's next tick no longer holds the claim; checkout --force on A restarts implement with record_lost", async () => {
    const s = await heldThenSilent(13, "wiped", 1);
    wipe(h.home);
    h.clock.advance(10_000);
    const t = await h.tick();
    const mine = t.decisions.filter((d) => d.unit.startsWith(s.key) && d.kind !== "noop");
    expect(mine).toEqual([]);
    expect(t.decisions.find((d) => d.unit === s.key)?.rule).toBe("claim.other");
    expect(state(s.runs(h.root))).toBeNull();

    h.clock.advance(10_000);
    const r = await h.norn("story", "checkout", s.key, "--force");
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ forced: true, record: null, record_lost: true, restarted: `the run record of ${s.key} was on tester@box and is lost; restarting implement from the branch` });
    expect(state(s.runs(h.root))).toMatchObject({ step: "implement", attempt: 1, counters: { review_loop: 0 } });
    h.clock.advance(10_000);
    await h.tick();
    h.clock.advance(10_000);
    await h.tick();
    expect(state(s.runs(h.root))).toMatchObject({ step: "implement", attempt: 1, status: "running" });
  });

  test("AC4: with a ref: checkout --force on A unpacks it and continues where it was", async () => {
    const s = await heldThenSilent(14, "wiped-ref", 1);
    expect((await h.norn("story", "handoff", s.key)).exit).toBe(0);
    const sha = remoteRef(recordRef(s.key)) as string;
    // A takes it back, then its home is wiped
    h.clock.advance(10_000);
    expect((await h.norn("story", "checkout", s.key)).exit).toBe(0);
    wipe(h.home);
    h.clock.advance(10_000);
    const r = await h.norn("story", "checkout", s.key, "--force");
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ forced: true, record: { sha, unpacked: true }, record_lost: false });
    expect((r.value as CheckoutValue).restarted).toBeUndefined();
    expect(state(s.runs(h.root))).toMatchObject({ step: "implement", attempt: 2, counters: { review_loop: 1 } });
  });
});


describe("a lost-record checkout that cannot start the round takes nothing (review#1 S1)", () => {
  withHarness();

  /** B's checkout was refused: no claim of B's on the remote, no run state on B. */
  function nothingTaken(B: Clone, s: Held, r: { exit: number; value: unknown }, code: string) {
    expect(r.exit).not.toBe(0);
    expect(r.value).toMatchObject({ code });
    const claim = remoteRef(claimRef(s.key));
    if (claim) expect(sh(h.root, ["cat-file", "-p", claim])).not.toContain("bob@");
    expect(existsSync(storyRunStateOf(join(B.root, s.spec)))).toBe(false);
  }
  /** Commit `edit` in A's story worktree and push the branch. */
  function onBranch(s: Held, edit: (wt: string) => void) {
    edit(s.wt(h.root));
    sh(s.wt(h.root), ["add", "-A"]);
    sh(s.wt(h.root), ["commit", "-q", "-m", "edit on the branch"]);
    sh(s.wt(h.root), ["push", "-q", "origin", s.branch]);
  }

  test("S1: A's record lands on the remote while B takes the claim: B gives the claim back, starts no round, and A's record stays", async () => {
    const s = await heldThenSilent(20, "raced", 1);
    expire(s.key);
    const B = cloneOf(h, "b-race", "bob");
    // A's record (here any commit) is pushed the moment a claim for the story lands
    const record = sh(h.root, ["rev-parse", "main"]);
    const hook = join(h.remoteDir, "hooks", "post-receive");
    writeFileSync(hook, `#!/bin/sh\nwhile read old new ref; do\n  if [ "$ref" = "${claimRef(s.key)}" ]; then git update-ref ${recordRef(s.key)} ${record}; fi\ndone\nexit 0\n`);
    chmodSync(hook, 0o755);
    let r;
    try {
      r = await B.norn("story", "checkout", s.key);
    } finally {
      rmSync(hook, { force: true });
    }
    nothingTaken(B, s, r, "record_moved");
    expect((r.value as { error: string }).error).toContain("given back");
    expect(remoteRef(recordRef(s.key))).toBe(record);
  });

  test("S3: a story file on the branch that does not parse is refused, not read as not started", async () => {
    const s = await heldThenSilent(21, "bad-spec", 0);
    onBranch(s, (wt) => writeFileSync(join(wt, s.spec, "spec.md"), "---\nstatus: [unclosed\n---\n# broken\n"));
    expire(s.key);
    const B = cloneOf(h, "b-badspec", "bob");
    nothingTaken(B, s, await B.norn("story", "checkout", s.key), "corrupt");
  });

  test("S5: no workflow file on the branch for the frontmatter's workflow: refused workflow_invalid, nothing taken", async () => {
    const s = await heldThenSilent(22, "no-wf", 0);
    onBranch(s, (wt) => rmSync(join(workflowsDir(wt), "rv.yaml")));
    expire(s.key);
    const B = cloneOf(h, "b-nowf", "bob");
    const r = await B.norn("story", "checkout", s.key);
    nothingTaken(B, s, r, "workflow_invalid");
    expect((r.value as { error: string }).error).toContain("nothing was taken");
  });

  test("S5: an invalid workflow on the branch: refused workflow_invalid, nothing taken", async () => {
    const s = await heldThenSilent(23, "bad-wf", 0);
    onBranch(s, (wt) => writeFileSync(join(workflowsDir(wt), "rv.yaml"), "name: rv\nstart: nowhere\nsteps: {}\n"));
    expire(s.key);
    const B = cloneOf(h, "b-badwf", "bob");
    nothingTaken(B, s, await B.norn("story", "checkout", s.key), "workflow_invalid");
  });

  test("S5: a story not started on the branch (frontmatter new): no record lost; B takes the claim and its tick starts the story", async () => {
    const key = "gh-24";
    const spec = `.agents/specs/${key}-not-started`;
    h.remote.issues = [...h.remote.issues, issue(24, "not-started", ["norn", "norn:wf:rv"])];
    await h.tick("--sync");
    // A holds the claim, never started the story, then goes silent
    for (let i = 0; i < 4 && !remoteRef(claimRef(key)); i++) await tick();
    expect(remoteRef(claimRef(key))).toBeTruthy();
    // its intake branch reached the remote (a person pushed it)
    sh(h.worktree(`${key}-not-started`), ["push", "-q", "origin", `${key}-not-started`]);
    expect(sh(h.dir, ["--git-dir", h.remoteDir, "show", `${key}-not-started:${spec}/spec.md`])).toContain("status: new");
    expect(state(runStateOf(join(h.worktree(`${key}-not-started`), spec)))).toBeNull();
    expire(key);
    const B = cloneOf(h, "b-new", "bob");
    const r = await B.norn("story", "checkout", key);
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ record: null, record_lost: false, receipt: { file: null } });
    expect((r.value as { restarted?: string }).restarted).toBeUndefined();
    h.clock.advance(10_000);
    const t = await B.tick();
    expect(t.decisions.filter((d) => d.unit === key).map((d) => d.rule)).toContain("story.start");
    expect(state(runStateOf(join(B.worktree(`${key}-not-started`), spec)))).toMatchObject({ step: "implement", attempt: 1 });
  });
});
