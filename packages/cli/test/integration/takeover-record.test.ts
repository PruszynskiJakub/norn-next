/**
 * gh-195/10 (B22–B24, B33; T5, T5a): `norn story checkout` on another machine fetches the story's
 * record from `refs/norn/runs/<story>`, unpacks it into its own machine dir and continues where the
 * story was. A branch that moved ahead of the record's `Norn-Branch-Commit` is fine; a rewritten
 * branch restarts the step as a new attempt, saying why. A story without a branch skips the check.
 * Two clones of one bare remote, each with its own norn home, user and machine name (seam S1); a
 * stale record lease (another checkout pushed the ref) is one Check item, never a push every tick.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { RunnerPort } from "@norn/core";
import { recordRef, STORY_UNIT_DIR, ulid } from "@norn/schema";
import { appendReceipt, bindNornHome, handoffPath, readState, repoConfigPath, workflowsDir } from "@norn/store";
import type { CliDeps, CliResult, TickReport } from "../../src/index.ts";
import { createHarness, FakeRunner, type Harness, hostEnv, issue, runChecked, sh } from "../../../../test/support/harness.ts";
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

interface Clone {
  root: string;
  home: string;
  norn(...argv: string[]): Promise<CliResult>;
  at(cwd: string, ...argv: string[]): Promise<CliResult>;
  tick(...flags: string[]): Promise<TickReport>;
}

/** Another machine: its own clone, norn home, user@machine and runner; same remote, issues and clock. */
function cloneOf(name: string, user: string): Clone {
  const root = join(h.dir, name);
  sh(h.dir, ["clone", "-q", h.remoteDir, root]);
  sh(root, ["config", "user.email", `${user}@example.com`]);
  sh(root, ["config", "user.name", user]);
  const home = join(h.dir, `home-${name}`);
  mkdirSync(home);
  bindNornHome(root, home);
  const runner = new FakeRunner();
  (runner as { name: string }).name = `fake-${name}`;
  const deps: CliDeps = {
    cwd: root,
    env: { ...hostEnv(), NORN_HOME_DIR: home, USER: user, NORN_MACHINE: name, NORN_HOOK_COMMAND: "norn hook" },
    clock: h.clock,
    ports: { remote: h.remote, runner: runner as RunnerPort, notifiers: [] },
  };
  return {
    root,
    home,
    norn: (...argv) => runChecked(argv, deps),
    at: (cwd, ...argv) => runChecked(argv, { ...deps, cwd }),
    async tick(...flags) {
      const r = await runChecked(["tick", ...flags], deps);
      if (r.exit !== 0) throw new Error(`tick failed: ${r.stdout}`);
      return r.value as TickReport;
    },
  };
}

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

/** A story on clone A at review attempt 2 (one rework round: `review_loop` 1), then handed over by A. */
async function handedOverAtReview2(n: number, slug: string) {
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
  const r = await h.norn("story", "handoff", key);
  expect(r.exit).toBe(0);
  const sha = remoteRef(recordRef(key)) as string;
  expect(sha).toBeTruthy();
  return { key, spec, branch, wt, runs, sha };
}

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

describe("checkout unpacks the record from the ref and continues (B22, T5)", () => {
  test("AC1: after A's handoff at review#2, B holds the claim, the branches and the record, prints status and handoff, and its next tick resumes review#2 with the same counters", async () => {
    const s = await handedOverAtReview2(9, "parser");
    const B = cloneOf("b-ac1", "bob");
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
    // the status above the handoff's written part (B7)
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

    const B = cloneOf("b-ac2", "bob");
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
    const gone = remoteRef(`refs/heads/${s.branch}`) as string;
    // rewrite the branch: its tip replaced by another commit on the same parent
    sh(s.wt(h.root), ["reset", "-q", "--hard", "HEAD~1"]);
    h.write(join(s.wt(h.root), "rewrite.txt"), "history rewritten\n");
    sh(s.wt(h.root), ["add", "rewrite.txt"]);
    sh(s.wt(h.root), ["commit", "-q", "-m", "rewritten tip"]);
    sh(s.wt(h.root), ["push", "-q", "-f", "origin", s.branch]);
    const head = remoteRef(`refs/heads/${s.branch}`) as string;
    const B = cloneOf("b-ac3", "bob");

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

  test("AC4: a story whose branch is gone: checkout unpacks the record without the ancestry check and continues (B33)", async () => {
    const s = await handedOverAtReview2(12, "branchless");
    sh(h.root, ["push", "-q", "origin", `:refs/heads/${s.branch}`]);
    expect(remoteRef(`refs/heads/${s.branch}`)).toBeNull();

    const B = cloneOf("b-ac4", "bob");
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
  });
});

describe("a record lease another checkout broke is one Check item, not a push every tick (08-F4)", () => {
  test("under remote: B's push is refused as stale once; later ticks do not retry; checkout here re-reads the ref and the next tick pushes on top of it", async () => {
    const s = await handedOverAtReview2(13, "stale-lease");
    const B = cloneOf("b-stale", "bob");
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
