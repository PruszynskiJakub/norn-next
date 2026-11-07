/**
 * What a machine that does not hold a story sees of it. Clone
 * A holds the stories; clone B, another clone of the same bare remote with its own norn home, user and
 * machine name, ticks and views. Under `remote` B shows the step, attempt and counters from the record
 * ref; under `local` the claim, the branch, the last boundary, the PR with its CI and where the run
 * state is. The tick fetches only the record refs of stories held elsewhere; `story view` and `status`
 * fetch nothing and write nothing.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { RunnerPort } from "@norn/core";
import { type ClaimBlob, claimRef, recordRef } from "@norn/schema";
import { machineDir, repoConfigPath, setSpawnObserver, workflowsDir } from "@norn/store";
import type { ElsewhereView } from "@norn/view";
import type { CliDeps, CliResult } from "../../src/index.ts";
import { createHarness, FakeRunner, type Harness, hostEnv, issue, runChecked, sh } from "../../../../test/support/harness.ts";
import { runStateOf } from "../../../../test/support/run-state.ts";

setDefaultTimeout(120_000);

const TRIO = `name: trio
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: review, means: "every criterion has a passing test" } }
  review:
    type: agent
    skill: norn-review
    outcomes:
      approve: { to: qa, means: "no blocking findings" }
      changes_requested: { to: implement, counter: review_loop, means: "blocking findings" }
  qa:
    type: agent
    skill: norn-qa
    outcomes: { pass: { to: $done, means: "every criterion observed" } }
counters: { review_loop: { max: 3 } }
`;
const CONFIG = "provider: gh\nworkflow: trio\nmode: manual\n";
const teamConfig = (policy: "local" | "remote") => `provider: gh\nworkflow: trio\nrecord:\n  policy: ${policy}\n`;
/** `2099-01-15 10:00` from an ISO time, as the view prints it */
const minute = (iso: string) => iso.slice(0, 16).replace("T", " ");

interface Clone {
  root: string;
  deps: CliDeps;
  norn(...argv: string[]): Promise<CliResult>;
}
let h: Harness;
let B: Clone;

const tick = () => {
  h.clock.advance(10_000);
  return h.tick();
};
const inWt = (cwd: string, ...argv: string[]): Promise<CliResult> => {
  const env: Record<string, string | undefined> = { ...h.deps.env, NORN_AGENT_PID: String(process.pid) };
  for (const k of ["NORN_AGENT", "NORN_RUN", "NORN_STORY", "NORN_SLICE", "NORN_AGENT_SESSION_ID"]) delete env[k];
  return runChecked(argv, { ...h.deps, cwd, env });
};
/** Another machine: its own clone, norn home, user and machine name; the same remote, issues and clock. */
function cloneOf(name: string, user: string, machine: string): Clone {
  const root = join(h.dir, name);
  sh(h.dir, ["clone", "-q", h.remoteDir, root]);
  sh(root, ["config", "user.email", `${user}@example.com`]);
  sh(root, ["config", "user.name", user]);
  const home = join(h.dir, `home-${name}`);
  mkdirSync(home);
  const deps: CliDeps = {
    cwd: root,
    env: { ...hostEnv(), NORN_HOME_DIR: home, USER: user, NORN_MACHINE: machine, NORN_HOOK_COMMAND: "norn hook" },
    clock: h.clock,
    ports: { remote: h.remote, runner: new FakeRunner() as RunnerPort, notifiers: [] },
  };
  return { root, deps, norn: (...argv) => runChecked(argv, deps) };
}
async function tickOn(c: Clone) {
  h.clock.advance(10_000);
  const r = await c.norn("tick", "--sync");
  expect(r.exit).toBe(0);
}

/** A trio story held by A at implement with its session started; `boundary` reports done and ticks until review's session started. */
async function storyOnA(n: number, slug: string, boundary: boolean) {
  const spec = `.agents/specs/gh-${n}-${slug}`;
  const wt = `${h.root}-worktrees/gh-${n}-${slug}`;
  const runs = () => runStateOf(join(wt, spec));
  h.remote.issues = [...h.remote.issues, issue(n, slug)];
  await h.tick("--sync");
  for (let i = 0; i < 10 && h.state(runs())?.step !== "implement"; i++) await tick();
  expect((await inWt(wt, "brief")).exit).toBe(0);
  await tick();
  if (boundary) {
    h.write(join(wt, "src", `gh-${n}.ts`), "export const x = 1;\n");
    expect((await inWt(wt, "done", "done", "--handoff", "implemented")).exit).toBe(0);
    for (let i = 0; i < 10 && h.state(runs())?.step !== "review"; i++) await tick();
    expect(h.state(runs())?.step).toBe("review");
    // review's session starts: its `started` commit (Norn-Step: review, no outcome) is pushed after the boundary
    expect((await inWt(wt, "brief")).exit).toBe(0);
    await tick();
  }
  return { key: `gh-${n}`, branch: `gh-${n}-${slug}`, wt, runs };
}

const remoteSha = (ref: string) => sh(h.dir, ["ls-remote", h.remoteDir, ref]).split(/\s+/)[0] || null;
/** The claim as the bare remote holds it: what B's expected times come from. */
const remoteClaim = (story: string): ClaimBlob => JSON.parse(sh(h.dir, ["--git-dir", h.remoteDir, "cat-file", "blob", claimRef(story)])) as ClaimBlob;
const view = async (key: string, c: Clone = B) => {
  const r = await c.norn("story", "view", key, "--json");
  expect(r.exit).toBe(0);
  return r.value as ElsewhereView;
};
const markdown = async (key: string) => (await B.norn("story", "view", key)).stdout;
const statusOf = async () => (await B.norn("status")).stdout;
/** The commits of a remote branch newer than `since`, their subjects and trailers. */
const commitsSince = (branch: string, since: string) => sh(h.dir, ["--git-dir", h.remoteDir, "log", "--format=%s%n%(trailers)", `${since}..refs/heads/${branch}`]);
/** Every file under a folder with its mtime, for "the view wrote nothing". */
function filesWithTimes(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(`${relative(dir, p)} ${statSync(p).mtimeMs}`);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.config(CONFIG);
  h.write(repoConfigPath(h.root), teamConfig("remote"));
  h.write(join(workflowsDir(h.root), "trio.yaml"), TRIO);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  B = cloneOf("repo-b", "bob", "repo-b");
});
afterAll(() => h.cleanup());

describe("a story held elsewhere under remote (B10, B17)", () => {
  test("AC1: A finishes implement, B ticks: story view and status on B show the step, attempt and counters from refs/norn/runs/gh-9", async () => {
    await storyOnA(9, "view-it", true);
    await tickOn(B);
    const record = remoteSha(recordRef("gh-9"));
    expect(record).not.toBeNull();
    expect(sh(B.root, ["rev-parse", recordRef("gh-9")])).toBe(record as string);

    const v = await view("gh-9");
    expect(v.holder).toBe("tester@box");
    expect(v.record?.sha).toBe(record as string);
    expect(v.record?.current).toBe(true);
    expect(v.record?.errors).toEqual([]);
    expect(v.record?.units[0]).toMatchObject({ key: "gh-9", step: "review", attempt: 1, counters: [{ name: "review_loop", value: 0, max: 3 }] });

    const md = await markdown("gh-9");
    expect(md).toContain("Step: review (attempt 1)");
    expect(md).toContain("review_loop 0/3");
    expect(md).not.toContain("run state is on");
    expect(md).not.toContain("record as of");
    expect(await statusOf()).toMatch(/gh-9 .*held by tester@box · Step: review \(attempt 1\) \[review_loop 0\/3\]/);
  });

  test("F12: a verb on a story held elsewhere reads its cursor from the record ref it fetches", async () => {
    const r = await B.norn("story", "answer", "gh-9", "use option b", "--json");
    expect(r.exit).toBe(3);
    expect(r.stdout).toContain("gh-9 is not waiting for an answer: it is at review#1");
  });

  test("AC2: after the team switches remote → local, B labels the ref with its age and says where the record is now", async () => {
    // the team's switch: committed and pushed on A, pulled on B
    h.write(repoConfigPath(h.root), teamConfig("local"));
    h.git(["commit", "-q", "-am", "record.policy local"]);
    h.git(["push", "-q", "origin", "main"]);
    sh(B.root, ["pull", "-q", "--ff-only", "origin", "main"]);

    const at = new Date(sh(h.dir, ["--git-dir", h.remoteDir, "log", "-1", "--format=%cI", recordRef("gh-9")])).toISOString();
    const v = await view("gh-9");
    expect(v.policy).toBe("local");
    expect(v.record?.current).toBe(false);
    expect(v.record?.at).toBe(at);
    expect(v.record?.units[0]).toMatchObject({ step: "review", attempt: 1 });
    const md = await markdown("gh-9");
    expect(md).toContain("Step: review (attempt 1)");
    expect(md).toContain(`record as of ${minute(at)} — gh-9 now keeps its record on tester@box's machine`);
    expect(await statusOf()).toContain(`record as of ${minute(at)}`);
  });
});

describe("a story held elsewhere under local (B18, B19)", () => {
  let s: Awaited<ReturnType<typeof storyOnA>>;
  test("AC3: a boundary for implement and a PR with CI: holder, heartbeat, expiry, the branch's last commit, last boundary, PR and CI, where the run state is; no attempt or counters", async () => {
    s = await storyOnA(11, "local-one", true);
    expect(remoteSha(recordRef("gh-11"))).toBeNull();
    h.remote.prs.push({ number: 111, url: "https://github.com/o/r/pull/111", state: "open", is_draft: true, head_sha: "", head: s.branch, base_branch: "main", merged_at: null });
    h.remote.ci.set(111, "failure");
    await tickOn(B);

    const claim = remoteClaim("gh-11");
    const head = remoteSha(`refs/heads/${s.branch}`) as string;
    const v = await view("gh-11");
    expect(v).toMatchObject({ holder: "tester@box", renewed_at: claim.renewed_at, expires_at: claim.expires_at, record: null, last_boundary: "implement", ci: "failure" });
    expect(v.head?.sha).toBe(head);
    expect(v.pr).toMatchObject({ number: 111, state: "open", is_draft: true });

    const md = await markdown("gh-11");
    expect(md).toContain("Held by: tester@box");
    expect(md).toContain(`heartbeat ${minute(claim.renewed_at)}`);
    expect(md).toContain(`expires ${minute(claim.expires_at)}`);
    expect(md).toContain(`${s.branch} at ${head.slice(0, 7)}`);
    expect(md).toContain("last boundary: implement");
    expect(md).toContain("#111 draft, open — https://github.com/o/r/pull/111");
    expect(md).toContain("CI: failure");
    expect(md).toContain(`run state is on tester@box's machine — ask them to run norn story handoff gh-11, or take it over after the claim expires (${minute(claim.expires_at)})`);
    expect(md).not.toContain("attempt");
    expect(md).not.toContain("counters");
    expect(md).not.toContain("review_loop");
    expect(await statusOf()).toMatch(/gh-11 .*held by tester@box · last boundary: implement · PR #111 · CI: failure/);
  });

  test("F9: a mirror and an ask commit after the boundary do not move it", async () => {
    const before = remoteSha(`refs/heads/${s.branch}`) as string;
    // a mirror commit: a label was added to the issue on the remote
    h.remote.issues = h.remote.issues.map((i) => (i.number === 11 ? { ...i, labels: [...i.labels, "ui"] } : i));
    await h.tick("--sync");
    // an ask commit: review's agent asks, its work so far committed with the park
    h.write(join(s.wt, "notes", "review.md"), "half done\n");
    expect((await inWt(s.wt, "ask", "Which option?")).exit).toBe(0);
    await tick();
    const after = commitsSince(s.branch, before);
    expect(after).toContain("norn: mirror gh-11 from the remote issue");
    expect(after).toContain("asks: Which option?");
    expect(after).not.toContain("Norn-Outcome");

    await tickOn(B);
    expect((await view("gh-11")).last_boundary).toBe("implement");
    expect(await markdown("gh-11")).toContain("last boundary: implement");
  });

  test("F16: a CI read that fails leaves the PR seen and the CI unknown, and the sync says so", async () => {
    h.remote.ciError = Object.assign(new Error("gh pr checks failed (exit 1): HTTP 502"), { code: "gh_failed", retryable: true });
    try {
      h.clock.advance(10_000);
      const r = await B.norn("tick", "--sync");
      expect(r.exit).toBe(0);
      const report = r.value as { sync: { ran: boolean; ok: boolean; error?: string } };
      expect(report.sync).toMatchObject({ ran: true, ok: false });
      expect(report.sync.error).toContain("CI of gh-11's PR #111");
      const v = await view("gh-11");
      expect(v.pr).toMatchObject({ number: 111 });
      expect(v.ci).toBeNull();
      expect(await markdown("gh-11")).toContain("CI: not seen yet");
    } finally {
      h.remote.ciError = null;
    }
  });

  test("F15: a step parked on $stuck and resumed by run rerun ends no step: the last boundary stays", async () => {
    const t = await storyOnA(13, "stuck-one", true);
    const before = remoteSha(`refs/heads/${t.branch}`) as string;
    h.write(join(t.wt, "notes", "stuck.md"), "blocked\n");
    expect((await inWt(t.wt, "stuck", "the fixture is gone")).exit).toBe(0);
    await tick();
    expect(h.state(t.runs())?.status).toBe("stuck");
    expect((await h.norn("run", "rerun", "gh-13", "--reason", "fixture restored")).exit).toBe(0);
    h.write(join(t.wt, "notes", "stuck.md"), "unblocked\n");
    await tick();
    expect(h.state(t.runs())).toMatchObject({ step: "review", status: "ready" });
    const after = commitsSince(t.branch, before);
    expect(after).toContain("unstick");
    expect(after).not.toContain("Norn-Outcome");

    await tickOn(B);
    expect((await view("gh-13")).last_boundary).toBe("implement");
  });

  test("AC4: no boundary commit yet (the start, a mirror and an ask commit are none): 'no boundary pushed yet'", async () => {
    const t = await storyOnA(12, "not-yet", false);
    h.remote.issues = h.remote.issues.map((i) => (i.number === 12 ? { ...i, labels: [...i.labels, "ui"] } : i));
    await h.tick("--sync");
    h.write(join(t.wt, "notes", "implement.md"), "half done\n");
    expect((await inWt(t.wt, "ask", "Which option?")).exit).toBe(0);
    await tick();
    const log = sh(h.dir, ["--git-dir", h.remoteDir, "log", "--format=%s", `refs/heads/${t.branch}`]);
    expect(log).toContain("norn: mirror gh-12 from the remote issue");
    expect(log).toContain("asks: Which option?");

    await tickOn(B);
    const v = await view("gh-12");
    expect(v.last_boundary).toBeNull();
    const md = await markdown("gh-12");
    expect(md).toContain("no boundary pushed yet");
    expect(md).not.toContain("last boundary:");
    expect(await statusOf()).toMatch(/gh-12 .*no boundary pushed yet/);
  });
});

describe("the tick fetches only the record refs it needs (B30)", () => {
  test("AC5: gh-9 held by A, gh-10 held by B with a ref, a closed gh-4 with a ref: B fetches refs/norn/runs/gh-9 only; views fetch and write nothing", async () => {
    // gh-10 is B's own: B intakes and claims it
    h.remote.issues = [...h.remote.issues, issue(10, "b-holds")];
    for (let i = 0; i < 3; i++) await tickOn(B);
    expect(remoteClaim("gh-10").holder).toBe("bob@repo-b");
    // the remote holds a record ref of gh-10 (B's own) and of gh-4 (finished long ago: no claim)
    const gh9 = remoteSha(recordRef("gh-9")) as string;
    sh(h.root, ["push", "-q", "origin", `${gh9}:${recordRef("gh-4")}`, `${gh9}:${recordRef("gh-10")}`]);
    expect(remoteSha(recordRef("gh-4"))).not.toBeNull();
    expect(sh(h.dir, ["ls-remote", h.remoteDir, claimRef("gh-4")])).toBe("");
    await tickOn(B);

    const records = sh(B.root, ["for-each-ref", "--format=%(refname)", "refs/norn/runs/"]).split("\n").filter(Boolean);
    expect(records).toEqual([recordRef("gh-9")]);

    const machine = machineDir(B.root);
    const files = filesWithTimes(machine);
    const spawned: string[][] = [];
    const prev = setSpawnObserver((x) => void spawned.push([...x.argv]));
    try {
      for (let i = 0; i < 2; i++) {
        expect(await markdown("gh-9")).toContain("Step: review (attempt 1)");
        expect((await B.norn("status")).exit).toBe(0);
      }
    } finally {
      setSpawnObserver(prev);
    }
    expect(spawned.length).toBeGreaterThan(0);
    expect(spawned.filter((a) => a.includes("fetch") || a.includes("ls-remote") || a.includes("push"))).toEqual([]);
    // the record is read from git objects: nothing unpacked, nothing written in the machine dir
    expect(filesWithTimes(machine)).toEqual(files);
  });

  test("F10: another clone of the same user@host is another checkout: it sees A's stories as held elsewhere", async () => {
    const C = cloneOf("repo-c", "tester", "box");
    await tickOn(C);
    const v = await view("gh-9", C);
    expect(v.holder).toBe("tester@box");
    expect(v.record?.units[0]).toMatchObject({ step: "review", attempt: 1 });
  });
});
