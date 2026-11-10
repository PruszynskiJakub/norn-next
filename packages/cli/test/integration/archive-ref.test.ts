/**
 * A finished story's record is archived on its ref
 * `refs/norn/runs/<story>`, never on the base. GR6 and GR6b push it before any cleanup; `run list`,
 * `run view` and `story reopen` read it on a fresh clone, fetching that one ref; `tidy` never touches
 * the refs; run state an older norn left on the base is never read.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { RunnerPort } from "@norn/core";
import { recordRef } from "@norn/schema";
import { bindNornHome, readState, runStateDir, storyRunStateDir, workflowsDir } from "@norn/store";
import type { CliDeps, CliResult, TickReport } from "../../src/index.ts";
import { createHarness, FakeRunner, type Harness, hostEnv, issue, runChecked, sh } from "../../../../test/support/harness.ts";
import { runStateOf, storyRunStateOf } from "../../../../test/support/run-state.ts";

setDefaultTimeout(90_000);

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
const CONFIG = "provider: gh\nworkflow: ready\nmode: auto\n";

let h: Harness;
const tick = (): Promise<TickReport> => {
  h.clock.advance(10_000);
  return h.tick();
};
const acted = (r: TickReport, unit: string) => r.decisions.filter((d) => d.unit === unit && d.kind !== "noop" && d.rule !== "claim.renew");
const remoteRefs = (prefix: string): string[] =>
  sh(h.dir, ["ls-remote", h.remoteDir, `${prefix}*`])
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("\t")[1] as string);
const remoteSha = (ref: string): string | null => sh(h.dir, ["ls-remote", h.remoteDir, ref]).split(/\s+/)[0] || null;
const recordFiles = (sha: string): string[] => sh(h.dir, ["--git-dir", h.remoteDir, "ls-tree", "-r", "--name-only", sha]).split("\n").filter(Boolean).sort();
function filesOf(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) (e.isDirectory() ? walk : (p: string) => out.push(relative(dir, p)))(join(d, e.name));
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}
/** paths under any `runs/` of a spec folder on `rev` */
const treeRunState = (cwd: string, rev: string) =>
  sh(cwd, ["ls-tree", "-r", "--name-only", rev, "--", ".agents/specs"])
    .split("\n")
    .filter((p) => /^\.agents\/specs\/[^/]+\/runs\//.test(p));

interface Clone {
  root: string;
  norn: (...argv: string[]) => Promise<CliResult>;
}
/** A second machine: a fresh clone of the remote with its own norn home, user and machine name. */
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
  return { root, norn: (...argv) => runChecked(argv, deps) };
}

/** A story at `$done` of the ready workflow: implement reported, the gate approved, the state pushed. */
async function finished(n: number, slug: string) {
  const branch = `gh-${n}-${slug}`;
  const spec = `.agents/specs/${branch}`;
  const wt = h.worktree(branch);
  const runs = () => runStateOf(join(wt, spec));
  h.remote.issues = [...h.remote.issues, issue(n, slug)];
  await h.tick("--sync");
  for (let i = 0; i < 8 && h.state(runs())?.status !== "running"; i++) await tick();
  expect(h.state(runs())?.status).toBe("running");
  await tick();
  h.report(runs(), "done", { outcome: "done", handoff: "built" });
  for (let i = 0; i < 6 && h.state(runs())?.park?.kind !== "gate"; i++) await tick();
  expect((await h.norn("story", "approve", `gh-${n}`)).exit).toBe(0);
  for (let i = 0; i < 6 && h.state(runs())?.status !== "done"; i++) await tick();
  expect(h.state(runs())).toMatchObject({ step: "$done", status: "done" });
  await tick(); // push
  // named from the main checkout: the worktree goes away
  return { key: `gh-${n}`, branch, spec, wt, record: () => storyRunStateOf(join(h.root, spec)) };
}

/** Merge `branch` into main from another clone and push it, as a person on GitHub would. */
function mergeOnRemote(branch: string): string {
  const other = join(h.dir, `merger-${branch}`);
  sh(h.dir, ["clone", "-q", h.remoteDir, other]);
  sh(other, ["-c", "user.email=m@x", "-c", "user.name=Merger", "merge", "-q", "--no-ff", "--no-edit", `origin/${branch}`]);
  sh(other, ["push", "-q", "origin", "main"]);
  return sh(other, ["rev-parse", "HEAD"]);
}

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.config(CONFIG);
  h.write(join(workflowsDir(h.root), "ready.yaml"), READY);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
});
afterAll(() => h.cleanup());

describe("GR6: a merged story's record is archived on its ref before the cleanup (B29–B31)", () => {
  let s: Awaited<ReturnType<typeof finished>>;
  let runId = "";

  beforeAll(async () => {
    s = await finished(9, "archive-me");
  });

  test("AC1: a rejected archive push leaves the cleanup owed; the next tick pushes the ref, then cleans up; the base gains no run state", async () => {
    const head = h.git(["rev-parse", "HEAD"], s.wt);
    mergeOnRemote(s.branch);
    h.remote.prs = [{ number: 19, url: "https://github.com/o/r/pull/19", state: "merged", is_draft: false, head_sha: head, merged_at: "2099-01-15T11:00:00Z", head: s.branch, base_branch: "main" }];
    const hook = join(h.remoteDir, "hooks", "pre-receive");
    writeFileSync(hook, `#!/bin/sh\nwhile read old new ref; do\n  case "$ref" in ${recordRef("gh-9")}) echo "archive refused" >&2; exit 1;; esac\ndone\nexit 0\n`);
    chmodSync(hook, 0o755);
    try {
      h.clock.advance(10_000);
      const failed = (await h.norn("sync")).value as TickReport;
      expect(acted(failed, "gh-9").map((d) => `${d.kind} ${d.ok}`)).toEqual(["cleanup_merged_story false"]);
      expect(acted(failed, "gh-9")[0]?.error).toContain(recordRef("gh-9"));
      // nothing was cleaned up: worktree, branch and claim are all still there
      expect(existsSync(s.wt)).toBe(true);
      expect(remoteSha(`refs/heads/${s.branch}`)).not.toBeNull();
      expect(remoteSha("refs/norn/claims/gh-9")).not.toBeNull();
      expect(remoteSha(recordRef("gh-9"))).toBeNull();
    } finally {
      rmSync(hook, { force: true });
    }
    h.clock.advance(10_000);
    const done = (await h.norn("sync")).value as TickReport;
    expect(acted(done, "gh-9").map((d) => `${d.kind} ${d.ok}`)).toEqual(["cleanup_merged_story true"]);
    const sha = remoteSha(recordRef("gh-9"));
    expect(sha).not.toBeNull();
    expect(recordFiles(sha as string)).toEqual(filesOf(s.record()));
    expect(recordFiles(sha as string)).toContain("_story/rounds/01-ready/state.json");
    expect(existsSync(s.wt)).toBe(false);
    expect(remoteSha("refs/norn/claims/gh-9")).toBeNull();
    h.git(["fetch", "-q", "origin"]);
    expect(h.git(["show", `origin/main:${s.spec}/spec.md`])).toContain("status: done");
    expect(treeRunState(h.root, "origin/main")).toEqual([]);
    const listed = (await h.norn("run", "list", "gh-9", "--json")).value as { steps: Array<{ who: Array<{ run_id: string | null }> }> };
    runId = listed.steps.flatMap((r) => r.who.map((w) => w.run_id)).find((x): x is string => !!x) ?? "";
    expect(runId).not.toBe("");
  });

  test("AC2: a fresh clone carries no archive ref; run list and run view fetch refs/norn/runs/gh-9 alone and list every round and step", async () => {
    const B = cloneOf("repo-b", "bob");
    expect(sh(B.root, ["for-each-ref", "refs/norn/"])).toBe("");
    const list = await B.norn("run", "list", "gh-9", "--json");
    expect(list.exit).toBe(0);
    const v = list.value as { rounds: Array<{ n: number; workflow: string }>; steps: Array<{ step: string }>; records: { source: string } };
    expect(v.records.source).toBe("archive");
    expect(v.rounds.map((r) => `${r.n} ${r.workflow}`)).toEqual(["1 ready"]);
    expect(v.steps.map((r) => r.step)).toEqual(["implement", "ready"]);
    expect(sh(B.root, ["for-each-ref", "--format=%(refname)", "refs/norn/"])).toBe(recordRef("gh-9"));

    const C = cloneOf("repo-c", "carol");
    const view = await C.norn("run", "view", runId, "--json");
    expect(view.exit).toBe(0);
    expect(view.value).toMatchObject({ story: "gh-9", run_id: runId });
    expect(sh(C.root, ["for-each-ref", "--format=%(refname)", "refs/norn/"])).toBe(recordRef("gh-9"));
  });

  test("AC4: tidy neither lists nor deletes an archive ref, here or on the remote", async () => {
    const before = remoteSha(recordRef("gh-9"));
    for (const argv of [["tidy", "--dry-run", "--json"], ["tidy", "--json"]]) {
      const r = await h.norn(...argv);
      expect(r.exit).toBe(0);
      expect(JSON.stringify(r.value)).not.toContain("refs/norn/runs");
    }
    expect(remoteSha(recordRef("gh-9"))).toBe(before);
    expect(h.git(["for-each-ref", "--format=%(refname)", "refs/norn/runs/"])).toBe(recordRef("gh-9"));
  });
});

describe("GR6b: a story closed without a PR is archived, and reopened from its ref on any clone (B29, B32)", () => {
  let s: Awaited<ReturnType<typeof finished>>;

  beforeAll(async () => {
    h.remote.prs = [];
    s = await finished(10, "close-me");
  });

  test("AC3: the tick closing it pushes the final record to the ref first; the base gains no run state", async () => {
    const i = h.remote.issues.find((x) => x.number === 10);
    if (!i) throw new Error("no issue");
    i.state = "closed";
    h.clock.advance(10_000);
    const r = (await h.norn("sync")).value as TickReport;
    expect(acted(r, "gh-10").map((d) => `${d.kind} ${d.ok}`)).toEqual(["close_story true"]);
    const sha = remoteSha(recordRef("gh-10"));
    expect(sha).not.toBeNull();
    expect(recordFiles(sha as string)).toEqual(filesOf(s.record()));
    expect(existsSync(s.wt)).toBe(false);
    h.git(["fetch", "-q", "origin"]);
    expect(treeRunState(h.root, "origin/main")).toEqual([]);
    expect(treeRunState(h.root, `origin/${s.branch}`)).toEqual([]);
  });

  test("AC5: with the issue reopened, story reopen on another clone unpacks the record: gh-10 is at its last round's $done", async () => {
    const i = h.remote.issues.find((x) => x.number === 10);
    if (!i) throw new Error("no issue");
    i.state = "open";
    const D = cloneOf("repo-d", "dana");
    const r = await D.norn("story", "reopen", "gh-10");
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ story: "gh-10", reopened: true });
    const story = { key: "gh-10", spec_dir: s.spec };
    // the record as archived, plus the take receipt the reopen wrote
    const archived = recordFiles(remoteSha(recordRef("gh-10")) as string);
    expect(archived.length).toBeGreaterThan(0);
    expect(filesOf(storyRunStateDir(D.root, story))).toEqual(expect.arrayContaining(archived));
    const st = readState(runStateDir(D.root, story, "_story"));
    expect(st.ok && st.value).toMatchObject({ step: "$done", status: "done", workflow: "ready" });
    const status = (await D.norn("status", "--json")).value as { groups: Record<string, Array<{ story: string }>> };
    expect(status.groups.your_turn).toContainEqual(expect.objectContaining({ story: "gh-10" }));
  });
});

describe("run state an older norn left on the base is never read, moved or warned about", () => {
  const OLD = ".agents/specs/gh-1-projects-and-items";

  test("run list is empty for it, no status item or hint names it, and doctor has no run-state check in markdown or --json", async () => {
    h.git(["fetch", "-q", "origin"]);
    h.git(["merge", "-q", "--ff-only", "origin/main"]);
    cpSync(join(import.meta.dir, "../../../view/test/integration/fixtures/gh-1/spec"), join(h.root, OLD), { recursive: true });
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "merge gh-1 (older norn)"]);
    h.git(["push", "-q", "origin", "main"]);
    await h.norn("sync");
    const head = h.git(["rev-parse", "HEAD"]);

    const list = await h.norn("run", "list", "gh-1", "--json");
    expect(list.exit).toBe(0);
    expect((list.value as { steps: unknown[] }).steps).toEqual([]);
    const status = await h.norn("status", "--json");
    expect(JSON.stringify(status.value)).not.toMatch(/base_run_state|run state is still on/);
    expect((await h.norn("status")).stdout).not.toContain("run state is still on");
    const doctor = await h.norn("doctor", "--repo", "--json");
    expect(Object.keys((doctor.value as { repo: Record<string, unknown> }).repo)).not.toContain("run_state");
    const text = (await h.norn("doctor", "--repo")).stdout;
    expect(text).not.toMatch(/run state/i);
    // nothing moved it off the base
    expect(h.git(["rev-parse", "HEAD"])).toBe(head);
    expect(existsSync(join(h.root, OLD, "runs"))).toBe(true);
  });
});
