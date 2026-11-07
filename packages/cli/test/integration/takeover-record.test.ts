/**
 * `norn story checkout` on another machine fetches the story's
 * record from `refs/norn/runs/<story>`, unpacks it into its own machine dir and continues where the
 * story was. A branch that moved ahead of the record's `Norn-Branch-Commit` is fine; a rewritten
 * branch restarts the step as a new attempt, saying why. A story without a branch skips the check.
 * Two clones of one bare remote, each with its own norn home, user and machine name (seam S1); a
 * stale record lease (another checkout pushed the ref) is one Check item, never a push every tick.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { claimRef, recordRef, STORY_UNIT_DIR, ulid } from "@norn/schema";
import { appendReceipt, handoffPath, machineDir, readState, repoConfigPath, workflowsDir } from "@norn/store";
import type { CliResult, TickReport } from "../../src/index.ts";
import { createHarness, type Harness, issue, sh } from "../../../../test/support/harness.ts";
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
const kinds = (r: TickReport, key: string) => r.decisions.filter((d) => d.unit === key && d.kind !== "noop" && d.rule !== "claim.renew").map((d) => `${d.kind}${d.ok ? "" : ` FAILED ${d.error}`}`);
const remoteRef = (ref: string): string | null => sh(h.dir, ["ls-remote", h.remoteDir, ref]).split(/\s+/)[0] || null;
const localRef = (root: string, ref: string): string | null => {
  try {
    return sh(root, ["rev-parse", "--verify", "-q", ref]) || null;
  } catch {
    return null;
  }
};
function filesOf(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) (e.isDirectory() ? walk : (p: string) => out.push(relative(dir, p)))(join(d, e.name));
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}
const remoteFiles = (sha: string) => sh(h.dir, ["--git-dir", h.remoteDir, "ls-tree", "-r", "--name-only", sha]).split("\n").filter(Boolean).sort();

/**
 * B33 (review#2 F1): B's ticks continue a branchless story it took over: no intake (no new branch or
 * worktree), the take applied at review#2 with the same counters, the claim renewed.
 */
async function continuesBranchless(B: Clone, s: { key: string; spec: string; branch: string; wt: (root: string) => string }) {
  const seen: string[] = [];
  for (let i = 0; i < 3; i++) {
    h.clock.advance(4 * 60_000);
    const t = await B.tick();
    seen.push(...t.decisions.filter((d) => d.unit.startsWith(s.key)).map((d) => `${d.rule} ${d.kind}${d.ok ? "" : " FAILED"}`));
  }
  expect(seen.filter((x) => x.includes("intake"))).toEqual([]);
  expect(seen).toContain("receipts.apply apply_receipts");
  expect(seen).toContain("claim.renew claim");
  expect(seen.filter((x) => x.includes("FAILED"))).toEqual([]);
  expect(sh(B.root, ["branch", "--list", s.branch])).toBe("");
  expect(existsSync(s.wt(B.root))).toBe(false);
  const st = state(runStateOf(join(B.root, s.spec)));
  expect(st).toMatchObject({ step: "review", attempt: 2, counters: { review_loop: 1 } });
  expect(st?.applied_through).toBe(filesOf(join(runStateOf(join(B.root, s.spec)), "receipts")).length);
  expect(JSON.parse(sh(B.root, ["cat-file", "-p", claimRef(s.key)]))).toMatchObject({ holder: expect.stringMatching(/^bob@/) });
}

/** Force-push the story branch with its tip replaced by another commit on the same parent; returns the commit gone. */
function rewriteBranch(s: { wt: (root: string) => string; branch: string }): string {
  const gone = remoteRef(`refs/heads/${s.branch}`) as string;
  sh(s.wt(h.root), ["reset", "-q", "--hard", "HEAD~1"]);
  h.write(join(s.wt(h.root), "rewrite.txt"), "history rewritten\n");
  sh(s.wt(h.root), ["add", "rewrite.txt"]);
  sh(s.wt(h.root), ["commit", "-q", "-m", "rewritten tip"]);
  sh(s.wt(h.root), ["push", "-q", "-f", "origin", s.branch]);
  return gone;
}

/** A story on clone A at review attempt 2 (one rework round: `review_loop` 1), then handed over by A. */
async function handedOverAtReview2(n: number, slug: string, beforeHandoff?: (runs: string) => void) {
  const key = `gh-${n}`;
  const spec = `.agents/specs/${key}-${slug}`;
  const branch = `${key}-${slug}`;
  const wt = (root: string) => `${root}-worktrees/${branch}`;
  const runs = (root: string) => runStateOf(join(wt(root), spec));
  h.remote.issues = [...h.remote.issues, issue(n, slug, ["norn", "norn:wf:rv"])];
  await h.tick("--sync");
  await tickUntil(() => state(runs(h.root))?.status === "running");
  report(runs(h.root), "done");
  await tickUntil(() => state(runs(h.root))?.step === "review" && state(runs(h.root))?.status === "running");
  report(runs(h.root), "rework");
  await tickUntil(() => state(runs(h.root))?.step === "implement" && state(runs(h.root))?.status === "running");
  report(runs(h.root), "done");
  await tickUntil(() => state(runs(h.root))?.step === "review" && state(runs(h.root))?.status === "running");
  expect(state(runs(h.root))).toMatchObject({ step: "review", attempt: 2, counters: { review_loop: 1 } });
  const handoff = handoffPath(join(wt(h.root), spec), STORY_UNIT_DIR);
  h.write(handoff, `${existsSync(handoff) ? readFileSync(handoff, "utf8") : ""}\n## Resume\nReview the parser again.\n`);
  beforeHandoff?.(runs(h.root));
  const r = await h.norn("story", "handoff", key);
  expect(r.exit).toBe(0);
  const sha = remoteRef(recordRef(key)) as string;
  expect(sha).toBeTruthy();
  return { key, spec, branch, wt, runs, sha };
}

/**
 * Each describe gets its own repo and remote: every story clone A runs keeps a worktree, and a slot
 * with it (K4: 9 per machine), after it hands the story over.
 */
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

describe("checkout unpacks the record from the ref and continues (B22)", () => {
  withHarness();

  test("AC1: after A's handoff at review#2, B holds the claim, the branches and the record, prints status and handoff, and its next tick resumes review#2 with the same counters", async () => {
    const s = await handedOverAtReview2(9, "parser");
    const B = cloneOf(h, "b-ac1", "bob");
    h.clock.advance(10_000);
    const r = await B.norn("story", "checkout", s.key);
    expect(r.exit).toBe(0);
    const v = r.value as { claim: { holder: string }; record: { sha: string; unpacked: boolean }; restarted?: string; units: Array<{ unit: string; step: string; handoff: string }> };
    expect(v.claim.holder).toBe("bob@b-ac1");
    expect(v.record).toMatchObject({ ref: recordRef(s.key), sha: s.sha, unpacked: true });
    expect(v.restarted).toBeUndefined();
    expect(sh(s.wt(B.root), ["rev-parse", "HEAD"])).toBe(remoteRef(`refs/heads/${s.branch}`) as string);
    // the record in B's machine dir: every file of the ref, plus B's take receipt
    const dir = storyRunStateOf(join(s.wt(B.root), s.spec));
    const files = filesOf(dir);
    expect(files.filter((f) => !f.endsWith("-take.json"))).toEqual(remoteFiles(s.sha));
    expect(files.filter((f) => f.endsWith("-take.json"))).toHaveLength(1);
    expect(state(s.runs(B.root))).toMatchObject({ step: "review", attempt: 2, counters: { review_loop: 1 } });
    // the status above the handoff's written part
    const story = v.units.find((u) => u.unit === s.key);
    expect(story?.step).toBe("review");
    expect(story?.handoff).toContain("review");
    expect(story?.handoff).toContain("Review the parser again.");
    // 09-F4: the local record ref is the record B took over, so B's own pushes lease on it
    expect(localRef(B.root, recordRef(s.key))).toBe(s.sha);

    h.clock.advance(10_000);
    const t = await B.tick();
    expect(kinds(t, s.key)[0]).toBe("apply_receipts");
    expect(state(s.runs(B.root))).toMatchObject({ step: "review", attempt: 2, counters: { review_loop: 1 } });

    // B hands it back: its record push leases on the sha it unpacked, so it is not refused as stale
    const back = await B.norn("story", "handoff", s.key);
    expect(back.exit).toBe(0);
    const next = remoteRef(recordRef(s.key)) as string;
    expect(next).not.toBe(s.sha);
    expect(sh(B.root, ["rev-parse", `${next}^`])).toBe(s.sha);
  });

  test("AC2: a commit pushed on top of the story branch after the record: checkout unpacks and continues on the newer head (B23)", async () => {
    const s = await handedOverAtReview2(10, "ahead");
    h.write(join(s.wt(h.root), "later.txt"), "pushed after the record\n");
    sh(s.wt(h.root), ["add", "later.txt"]);
    sh(s.wt(h.root), ["commit", "-q", "-m", "a later commit"]);
    sh(s.wt(h.root), ["push", "-q", "origin", s.branch]);
    const head = remoteRef(`refs/heads/${s.branch}`) as string;

    const B = cloneOf(h, "b-ac2", "bob");
    h.clock.advance(10_000);
    const r = await B.norn("story", "checkout", s.key);
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ record: { sha: s.sha, unpacked: true } });
    expect((r.value as { restarted?: string }).restarted).toBeUndefined();
    expect(sh(s.wt(B.root), ["rev-parse", "HEAD"])).toBe(head);
    expect(readFileSync(join(s.wt(B.root), "later.txt"), "utf8")).toBe("pushed after the record\n");
    h.clock.advance(10_000);
    await B.tick();
    expect(state(s.runs(B.root))).toMatchObject({ step: "review", attempt: 2, counters: { review_loop: 1 } });
  });

  test("AC3: a force-pushed story branch: the record is kept, review restarts as attempt 3 with the reason in checkout and the brief (B24, T5a)", async () => {
    const s = await handedOverAtReview2(11, "rewritten");
    const gone = rewriteBranch(s);
    const head = remoteRef(`refs/heads/${s.branch}`) as string;
    const B = cloneOf(h, "b-ac3", "bob");

    h.clock.advance(10_000);
    const r = await B.norn("story", "checkout", s.key);
    expect(r.exit).toBe(0);
    const line = `the branch of ${s.key} was rewritten since the record (${gone} is gone); restarting review as attempt 3`;
    expect(r.value).toMatchObject({ record: { sha: s.sha, branch_commit: gone, unpacked: true }, restarted: line });
    const before = filesOf(storyRunStateOf(join(s.wt(B.root), s.spec)));
    expect(before.filter((f) => !f.endsWith("-take.json"))).toEqual(remoteFiles(s.sha));
    const take = before.find((f) => f.endsWith("-take.json")) as string;
    expect(JSON.parse(readFileSync(join(storyRunStateOf(join(s.wt(B.root), s.spec)), take), "utf8"))).toMatchObject({ kind: "take", step: "review", attempt: 2, rewritten: { gone, head } });

    h.clock.advance(10_000);
    await B.tick();
    const st = state(s.runs(B.root));
    // counters and history stay; the step starts again as a new attempt
    expect(st).toMatchObject({ step: "review", attempt: 3, counters: { review_loop: 1 }, visits: { implement: 2, review: 3 } });
    const receipts = filesOf(join(s.runs(B.root), "receipts"));
    expect(receipts.filter((f) => f.endsWith("-done.json")).length).toBe(3);

    const brief = await B.at(s.wt(B.root), "brief");
    expect(brief.exit).toBe(0);
    const why = brief.stdout.slice(brief.stdout.indexOf("## Why this attempt"), brief.stdout.indexOf("## Your work"));
    expect(why.toLowerCase()).toContain(line);
    const json = await B.at(s.wt(B.root), "brief", "--json");
    expect(json.value).toMatchObject({ brief: { where: { step: "review", attempt: 3 }, history: { rewritten: { gone, head, line } } } });
  });

  test("AC3: a record whose unapplied receipts move the cursor first: the step the cursor reaches restarts, and the brief says why (review F3)", async () => {
    // review#2 reported `rework` just before the handoff: the record carries it unapplied
    const s = await handedOverAtReview2(17, "moved-first", (runs) => report(runs, "rework"));
    const gone = rewriteBranch(s);
    const B = cloneOf(h, "b-ac3b", "bob");
    h.clock.advance(10_000);
    const r = await B.norn("story", "checkout", s.key);
    expect(r.exit).toBe(0);
    // the rework takes review#2 to implement#3, a fresh attempt that judged nothing yet: it is the
    // restart, counted once (review#2 F4, GR8)
    const line = `the branch of ${s.key} was rewritten since the record (${gone} is gone); restarting implement as attempt 3`;
    expect(r.value).toMatchObject({ restarted: line });
    // the status printed is the one the tick reaches (review#2 F7)
    expect((r.value as { units: Array<{ unit: string; step: string; handoff: string }> }).units.find((u) => u.unit === s.key)?.handoff).toContain("attempt 3");
    h.clock.advance(10_000);
    await B.tick();
    expect(state(s.runs(B.root))).toMatchObject({ step: "implement", attempt: 3, counters: { review_loop: 2 }, visits: { implement: 3, review: 2 } });
    const brief = await B.at(s.wt(B.root), "brief", "--json");
    expect(brief.value).toMatchObject({ brief: { where: { step: "implement", attempt: 3 }, history: { rewritten: { gone, line } } } });
  });

  test("AC4: a story whose branch is gone: checkout unpacks the record without the ancestry check and continues (B33)", async () => {
    const s = await handedOverAtReview2(12, "branchless");
    sh(h.root, ["push", "-q", "origin", `:refs/heads/${s.branch}`]);
    expect(remoteRef(`refs/heads/${s.branch}`)).toBeNull();

    const B = cloneOf(h, "b-ac4", "bob");
    h.clock.advance(10_000);
    const r = await B.norn("story", "checkout", s.key);
    expect(r.exit).toBe(0);
    const v = r.value as { branch: string | null; worktrees: unknown[]; restarted?: string; units: Array<{ unit: string; step: string; status: string }> };
    expect(v).toMatchObject({ claim: { holder: "bob@b-ac4" }, record: { sha: s.sha, unpacked: true } });
    expect(v.branch).toBeNull();
    expect(v.worktrees).toEqual([]);
    expect(v.restarted).toBeUndefined();
    expect(v.units.find((u) => u.unit === s.key)).toMatchObject({ step: "review" });
    // no worktree here: the run state is in B's machine dir all the same
    const dir = storyRunStateOf(join(B.root, s.spec));
    expect(filesOf(dir).filter((f) => !f.endsWith("-take.json"))).toEqual(remoteFiles(s.sha));
    expect(state(runStateOf(join(B.root, s.spec)))).toMatchObject({ step: "review", attempt: 2, counters: { review_loop: 1 } });
    expect(localRef(B.root, recordRef(s.key))).toBe(s.sha);
    await continuesBranchless(B, s);
  });

  test("AC4: a record made without a branch (no Norn-Branch-Commit) is checked out the same way and continues (B33)", async () => {
    const s = await handedOverAtReview2(18, "never-branched");
    // the same record, as a story that never had a branch would have pushed it: no Norn-Branch-Commit
    const tree = sh(h.root, ["rev-parse", `${s.sha}^{tree}`]);
    const bare = sh(h.root, ["commit-tree", tree, "-p", s.sha, "-m", `norn: record ${s.key}\n\nNorn-Story: ${s.key}\nNorn-Holder: tester@box`]);
    sh(h.root, ["push", "-q", "-f", "origin", `${bare}:${recordRef(s.key)}`]);
    sh(h.root, ["push", "-q", "origin", `:refs/heads/${s.branch}`]);
    const B = cloneOf(h, "b-ac4b", "bob");
    h.clock.advance(10_000);
    const r = await B.norn("story", "checkout", s.key);
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ branch: null, record: { sha: bare, branch_commit: null, unpacked: true } });
    expect((r.value as { restarted?: string }).restarted).toBeUndefined();
    await continuesBranchless(B, s);
  });
});

describe("a story held only from its record (B33, 10-R3-F2)", () => {
  withHarness();

  test("under remote, B's tick pushes the record of a branchless story it holds (no Norn-Branch-Commit); status lists it; B hands it over with the record pushed and the claim released", async () => {
    const s = await handedOverAtReview2(21, "record-only-remote");
    sh(h.root, ["push", "-q", "origin", `:refs/heads/${s.branch}`]);
    const B = cloneOf(h, "b-ro", "bob");
    h.write(repoConfigPath(B.root), "provider: gh\nworkflow: rv\nrecord:\n  policy: remote\n");
    h.clock.advance(10_000);
    expect((await B.norn("story", "checkout", s.key)).exit).toBe(0);

    h.clock.advance(10_000);
    const t = await B.tick();
    expect(t.decisions.filter((d) => d.unit === s.key && d.kind === "push_record").map((d) => `${d.ok}${d.error ? ` ${d.error}` : ""}`)).toEqual(["true"]);
    const pushed = remoteRef(recordRef(s.key)) as string;
    expect(sh(B.root, ["rev-parse", `${pushed}^`])).toBe(s.sha);
    const trailers = sh(B.root, ["log", "-1", "--format=%(trailers:only,unfold)", pushed]);
    expect(trailers).toContain(`Norn-Story: ${s.key}`);
    expect(trailers).toContain("Norn-Holder: bob@b-ro");
    expect(trailers).not.toContain("Norn-Branch-Commit");
    // the record pushed holds B's take
    expect(remoteFiles(pushed).some((f) => f.endsWith("-take.json"))).toBe(true);
    // nothing new to push: the next tick pushes nothing
    h.clock.advance(10_000);
    const t2 = await B.tick();
    expect(t2.decisions.filter((d) => d.unit === s.key && d.kind === "push_record")).toEqual([]);

    // status on B: the story it holds at review#2 is not running — the run in its record belongs to the
    // session on A, and nothing runs here until the story has a branch (review#1 S8)
    const status = await B.norn("status", "--json");
    const groups = (status.value as { groups: Record<string, Array<{ story: string; title: string; command: string }>> }).groups;
    const items = Object.entries(groups).flatMap(([g, list]) => list.filter((i) => i.story === s.key).map((i) => ({ group: g, title: i.title, command: i.command })));
    expect(items).toEqual([{ group: "check", title: `review #2: held here from its record; ${s.key} has no branch, so nothing runs`, command: `norn story view ${s.key}` }]);
    const listed = ((await B.norn("story", "list", "--json")).value as { stories: Array<{ key: string; step: string; attempt: number; branch: string | null; claim: { state: string } }> }).stories.find((x) => x.key === s.key);
    expect(listed).toMatchObject({ step: "review", attempt: 2, branch: null, claim: { state: "mine" } });

    // handing it over pushes the record and releases the claim
    h.clock.advance(10_000);
    const back = await B.norn("story", "handoff", s.key);
    expect(back.exit).toBe(0);
    expect(remoteRef(claimRef(s.key))).toBeNull();
    const after = remoteRef(recordRef(s.key)) as string;
    expect(after).toBe(pushed);
  });
});

/** A record commit on the remote's ref whose story state.json is not JSON; returns it and the blob's sha. */
function badRecord(key: string): { commit: string; blob: string } {
  const blob = sh(h.root, ["hash-object", "-w", "--stdin"], "{ not json");
  const t1 = sh(h.root, ["mktree"], `100644 blob ${blob}\tstate.json\n`);
  const t2 = sh(h.root, ["mktree"], `040000 tree ${t1}\t01-rv\n`);
  const t3 = sh(h.root, ["mktree"], `040000 tree ${t2}\trounds\n`);
  const t4 = sh(h.root, ["mktree"], `040000 tree ${t3}\t${STORY_UNIT_DIR}\n`);
  const commit = sh(h.root, ["commit-tree", t4, "-m", "bad record"]);
  sh(h.root, ["push", "-q", "-f", "origin", `${commit}:${recordRef(key)}`]);
  return { commit, blob };
}

describe("a record checkout cannot take takes nothing: no claim, no worktree, no run state (review F1)", () => {
  withHarness();

  async function expectNothingTaken(B: Clone, s: Awaited<ReturnType<typeof handedOverAtReview2>>, r: CliResult, code: string) {
    expect(r.exit).not.toBe(0);
    expect(r.value).toMatchObject({ code });
    expect((r.value as { do_instead: string }).do_instead).toContain(`norn story checkout ${s.key}`);
    expect(remoteRef(claimRef(s.key))).toBeNull();
    expect(localRef(B.root, claimRef(s.key))).toBeNull();
    expect(existsSync(s.wt(B.root))).toBe(false);
    expect(existsSync(storyRunStateOf(join(B.root, s.spec)))).toBe(false);
    expect(localRef(B.root, recordRef(s.key))).toBeNull();
    // the next tick does not start the story over
    for (let i = 0; i < 3; i++) {
      h.clock.advance(10_000);
      const t = await B.tick();
      // the open issue is seen (intake leaves the pushed branch as it is); nothing claims or starts it
      expect(t.decisions.filter((d) => d.unit.startsWith(s.key) && ["claim", "start_unit", "start_run", "push_record"].includes(d.kind))).toEqual([]);
    }
    expect(remoteRef(claimRef(s.key))).toBeNull();
    expect(existsSync(storyRunStateOf(join(B.root, s.spec)))).toBe(false);
  }

  test("a record that fails validation is refused before the claim", async () => {
    const s = await handedOverAtReview2(15, "corrupt-record");
    badRecord(s.key);
    const B = cloneOf(h, "b-corrupt", "bob");
    h.clock.advance(10_000);
    const r = await B.norn("story", "checkout", s.key);
    await expectNothingTaken(B, s, r, "record_corrupt");
    expect((r.value as { error: string }).error).toContain("invalid JSON");
  });

  test("a record that cannot be fetched is refused before the claim", async () => {
    const s = await handedOverAtReview2(16, "unfetchable-record");
    const B = cloneOf(h, "b-nofetch", "bob");
    // the remote lists the ref but cannot send it: the record's tree names a blob the bare repo never had
    // (built in the bare repo itself, so nothing depends on loose or packed objects)
    const remoteGit = (args: string[], input?: string) => sh(h.dir, ["--git-dir", h.remoteDir, ...args], input);
    const missing = "0123456789abcdef0123456789abcdef01234567";
    const tree = remoteGit(["mktree", "--missing"], `100644 blob ${missing}\tstate.json\n`);
    const commit = remoteGit(["commit-tree", tree, "-m", "record with a missing blob"]);
    remoteGit(["update-ref", recordRef(s.key), commit]);
    expect(remoteRef(recordRef(s.key))).toBe(commit);
    expect(() => remoteGit(["cat-file", "-e", missing])).toThrow();
    h.clock.advance(10_000);
    const r = await B.norn("story", "checkout", s.key);
    await expectNothingTaken(B, s, r, "network");
  });
});

describe("checkout is one transaction: every remote check before the claim (review#2 F2, F5)", () => {
  withHarness();

  test("a rewritten branch meeting a diverged local branch: refused before the claim; once reconciled, checkout still restarts the step", async () => {
    const s = await handedOverAtReview2(19, "diverged-rewrite");
    const B = cloneOf(h, "b-div", "bob");
    // B has an old local copy of the story branch, then A's side force-pushes a rewrite
    sh(B.root, ["fetch", "-q", "origin", `${s.branch}:${s.branch}`]);
    const gone = rewriteBranch(s);
    h.clock.advance(10_000);
    const r = await B.norn("story", "checkout", s.key);
    expect(r.exit).not.toBe(0);
    expect(r.value).toMatchObject({ code: "branch_diverged" });
    expect((r.value as { error: string }).error).toContain("nothing was taken");
    expect(remoteRef(claimRef(s.key))).toBeNull();
    expect(existsSync(storyRunStateOf(join(B.root, s.spec)))).toBe(false);
    expect(localRef(B.root, recordRef(s.key))).toBeNull();
    // the person reconciles the local branch; checkout then takes the story and still restarts review
    sh(B.root, ["branch", "-D", s.branch]);
    h.clock.advance(10_000);
    const again = await B.norn("story", "checkout", s.key);
    expect(again.exit).toBe(0);
    expect(again.value).toMatchObject({ restarted: `the branch of ${s.key} was rewritten since the record (${gone} is gone); restarting review as attempt 3` });
    h.clock.advance(10_000);
    await B.tick();
    expect(state(s.runs(B.root))).toMatchObject({ step: "review", attempt: 3, counters: { review_loop: 1 } });
    // a second checkout here (the claim is B's, its run state kept) does not restart it again
    h.clock.advance(10_000);
    const third = await B.norn("story", "checkout", s.key);
    expect(third.exit).toBe(0);
    expect((third.value as { restarted?: string }).restarted).toBeUndefined();
    h.clock.advance(10_000);
    await B.tick();
    expect(state(s.runs(B.root))).toMatchObject({ step: "review", attempt: 3 });
  });

  test("the record ref moving while the claim is taken (a still-running holder pushed): the claim is given back and nothing is placed", async () => {
    const s = await handedOverAtReview2(20, "moved-record");
    const B = cloneOf(h, "b-moved", "bob");
    // the remote moves the record ref the moment a claim for the story lands
    const later = sh(h.root, ["commit-tree", sh(h.root, ["rev-parse", `${s.sha}^{tree}`]), "-p", s.sha, "-m", `norn: record ${s.key}`]);
    sh(h.root, ["push", "-q", "origin", `${later}:refs/norn/spare/${s.key}`]);
    const hook = join(h.remoteDir, "hooks", "post-receive");
    writeFileSync(hook, `#!/bin/sh\nwhile read old new ref; do\n  if [ "$ref" = "${claimRef(s.key)}" ]; then git update-ref ${recordRef(s.key)} ${later}; fi\ndone\nexit 0\n`);
    chmodSync(hook, 0o755);
    try {
      h.clock.advance(10_000);
      const r = await B.norn("story", "checkout", s.key);
      expect(r.exit).not.toBe(0);
      expect(r.value).toMatchObject({ code: "record_moved" });
      expect((r.value as { do_instead: string }).do_instead).toContain(`norn story checkout ${s.key}`);
    } finally {
      rmSync(hook, { force: true });
    }
    expect(remoteRef(claimRef(s.key))).toBeNull();
    expect(existsSync(storyRunStateOf(join(B.root, s.spec)))).toBe(false);
    expect(localRef(B.root, recordRef(s.key))).toBeNull();
    // retried, it takes the record as it is now
    h.clock.advance(10_000);
    const again = await B.norn("story", "checkout", s.key);
    expect(again.exit).toBe(0);
    expect(again.value).toMatchObject({ record: { sha: later, unpacked: true } });
  });
});

describe("a record lease another checkout broke is one Check item, not a push every tick (08-F4)", () => {
  withHarness();

  test("under remote: B's push is refused as stale once; later ticks do not retry; checkout here re-reads the ref and the next tick pushes on top of it", async () => {
    const s = await handedOverAtReview2(13, "stale-lease");
    const B = cloneOf(h, "b-stale", "bob");
    h.write(repoConfigPath(B.root), "provider: gh\nworkflow: rv\nrecord:\n  policy: remote\n");
    h.clock.advance(10_000);
    expect((await B.norn("story", "checkout", s.key)).exit).toBe(0);
    // another checkout pushes the record ref under B's feet
    const other = sh(h.root, ["rev-parse", "main"]);
    sh(h.root, ["push", "-q", "-f", "origin", `${other}:${recordRef(s.key)}`]);

    h.clock.advance(10_000);
    const t1 = await B.tick();
    const failed = t1.decisions.filter((d) => d.unit === s.key && d.kind === "push_record");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.ok).toBe(false);
    expect(remoteRef(recordRef(s.key))).toBe(other);

    const inbox = async () => {
      const st = await B.norn("status", "--json");
      const groups = (st.value as { groups: Record<string, Array<{ id: string; story: string; title: string; command: string }>> }).groups;
      return Object.entries(groups).flatMap(([g, items]) => items.filter((i) => i.story === s.key && i.id.startsWith("record-push:")).map((i) => ({ group: g, ...i })));
    };
    const items = await inbox();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ group: "check", command: `norn story checkout ${s.key}` });
    expect(items[0]?.title).toContain(recordRef(s.key));

    // no tight loop: the next ticks do not push again while the lease is the same
    for (let i = 0; i < 2; i++) {
      h.clock.advance(10_000);
      const t = await B.tick();
      expect(t.decisions.filter((d) => d.unit === s.key && d.kind === "push_record")).toEqual([]);
    }
    expect(await inbox()).toHaveLength(1);
    // the refusal is the story's own slot, not the story unit's act failure (review F2)
    const failures = () => JSON.parse(readFileSync(join(machineDir(B.root), "failures.json"), "utf8")).units as Record<string, { effect: string }>;
    expect(Object.keys(failures())).toContain(`record:${s.key}`);
    expect(failures()[s.key]).toBeUndefined();

    // back to local: the refusal is forgotten (no item, no hold); remote again: the push is tried once more
    h.write(repoConfigPath(B.root), "provider: gh\nworkflow: rv\n");
    h.clock.advance(10_000);
    await B.tick();
    expect(await inbox()).toEqual([]);
    expect(failures()[`record:${s.key}`]).toBeUndefined();
    h.write(repoConfigPath(B.root), "provider: gh\nworkflow: rv\nrecord:\n  policy: remote\n");
    h.clock.advance(10_000);
    const retried = await B.tick();
    expect(retried.decisions.filter((d) => d.unit === s.key && d.kind === "push_record").map((d) => d.ok)).toEqual([false]);
    expect(await inbox()).toHaveLength(1);

    // the do_instead: checkout on the holder fetches the ref (its run state kept) and the next push goes on top
    const local = filesOf(storyRunStateOf(join(s.wt(B.root), s.spec)));
    h.clock.advance(10_000);
    const again = await B.norn("story", "checkout", s.key);
    expect(again.exit).toBe(0);
    expect(again.value).toMatchObject({ record: { sha: other, unpacked: false } });
    expect(filesOf(storyRunStateOf(join(s.wt(B.root), s.spec))).filter((f) => !f.endsWith("-take.json"))).toEqual(local.filter((f) => !f.endsWith("-take.json")));
    h.clock.advance(10_000);
    const t2 = await B.tick();
    expect(t2.decisions.filter((d) => d.unit === s.key && d.kind === "push_record").map((d) => d.ok)).toEqual([true]);
    const pushed = remoteRef(recordRef(s.key)) as string;
    expect(sh(B.root, ["rev-parse", `${pushed}^`])).toBe(other);
    expect(await inbox()).toEqual([]);
  });
});
