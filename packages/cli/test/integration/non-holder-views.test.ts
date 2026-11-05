/**
 * gh-195/12 (B10, B13, B17–B19, B30; D6): what a machine that does not hold a story sees of it. Clone
 * A holds the stories; clone B, another clone of the same bare remote with its own norn home, user and
 * machine name, ticks and views. Under `remote` B shows the step, attempt and counters from the record
 * ref; under `local` the claim, the branch, the last boundary, the PR and where the run state is. The
 * tick fetches only the record refs of stories held elsewhere; `story view` and `status` fetch nothing.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { RunnerPort } from "@norn/core";
import { recordRef } from "@norn/schema";
import { recordCacheDir, repoConfigPath, setSpawnObserver, workflowsDir } from "@norn/store";
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

let h: Harness;
let B: { root: string; deps: CliDeps; norn(...argv: string[]): Promise<CliResult> };

const tick = () => {
  h.clock.advance(10_000);
  return h.tick();
};
const inWt = (cwd: string, ...argv: string[]): Promise<CliResult> => {
  const env: Record<string, string | undefined> = { ...h.deps.env, NORN_AGENT_PID: String(process.pid) };
  for (const k of ["NORN_AGENT", "NORN_RUN", "NORN_STORY", "NORN_SLICE", "NORN_AGENT_SESSION_ID"]) delete env[k];
  return runChecked(argv, { ...h.deps, cwd, env });
};
async function bTick() {
  h.clock.advance(10_000);
  const r = await B.norn("tick", "--sync");
  expect(r.exit).toBe(0);
}

/** A trio story held by A at implement with its session started; `boundary` reports done and ticks to review. */
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
  }
  return { key: `gh-${n}`, branch: `gh-${n}-${slug}` };
}

const remoteSha = (ref: string) => sh(h.dir, ["ls-remote", h.remoteDir, ref]).split(/\s+/)[0] || null;
const view = async (key: string) => {
  const r = await B.norn("story", "view", key, "--json");
  expect(r.exit).toBe(0);
  return r.value as ElsewhereView;
};

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.config(CONFIG);
  h.write(repoConfigPath(h.root), teamConfig("remote"));
  h.write(join(workflowsDir(h.root), "trio.yaml"), TRIO);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);

  const root = join(h.dir, "repo-b");
  sh(h.dir, ["clone", "-q", h.remoteDir, root]);
  sh(root, ["config", "user.email", "bob@example.com"]);
  sh(root, ["config", "user.name", "bob"]);
  const home = join(h.dir, "home-b");
  mkdirSync(home);
  const deps: CliDeps = {
    cwd: root,
    env: { ...hostEnv(), NORN_HOME_DIR: home, USER: "bob", NORN_MACHINE: "repo-b", NORN_HOOK_COMMAND: "norn hook" },
    clock: h.clock,
    ports: { remote: h.remote, runner: new FakeRunner() as RunnerPort, notifiers: [] },
  };
  B = { root, deps, norn: (...argv) => runChecked(argv, deps) };
});
afterAll(() => h.cleanup());

describe("a story held elsewhere under remote (B10, B17)", () => {
  test("AC1: A finishes implement, B ticks: story view and status on B show the step, attempt and counters from refs/norn/runs/gh-9", async () => {
    await storyOnA(9, "view-it", true);
    await bTick();
    const record = remoteSha(recordRef("gh-9"));
    expect(record).not.toBeNull();
    expect(sh(B.root, ["rev-parse", recordRef("gh-9")])).toBe(record as string);

    const v = await view("gh-9");
    expect(v.holder).toBe("tester@box");
    expect(v.record?.sha).toBe(record as string);
    expect(v.record?.current).toBe(true);
    expect(v.record?.units[0]).toMatchObject({ key: "gh-9", step: "review", attempt: 1, counters: [{ name: "review_loop", value: 0, max: 3 }] });
    expect(v.where).toEqual([]);

    const md = (await B.norn("story", "view", "gh-9")).stdout;
    expect(md).toContain("Step: review (attempt 1)");
    expect(md).toContain("review_loop 0/3");
    const status = await B.norn("status");
    expect(status.exit).toBe(0);
    expect(status.stdout).toContain("gh-9");
    expect(status.stdout).toContain("Step: review (attempt 1) [review_loop 0/3]");
  });

  test("AC2: after the team switches remote → local, B labels the ref with its age and says where the record is now", async () => {
    h.write(repoConfigPath(B.root), teamConfig("local"));
    const at = sh(B.root, ["log", "-1", "--format=%cI", recordRef("gh-9")]);
    const v = await view("gh-9");
    expect(v.record?.current).toBe(false);
    expect(v.record?.units[0]).toMatchObject({ step: "review", attempt: 1 });
    const md = (await B.norn("story", "view", "gh-9")).stdout;
    expect(md).toContain("Step: review (attempt 1)");
    expect(md).toContain(`record as of ${minute(new Date(at).toISOString())} — gh-9 now keeps its record on tester@box's machine`);
    expect((await B.norn("status")).stdout).toContain(`record as of ${minute(new Date(at).toISOString())}`);
  });
});

describe("a story held elsewhere under local (B18, B19)", () => {
  test("AC3: a boundary for implement and a PR: holder, heartbeat, expiry, the branch's last commit, last boundary, the PR, where the run state is; no attempt or counters", async () => {
    h.write(repoConfigPath(h.root), teamConfig("local"));
    const s = await storyOnA(11, "local-one", true);
    expect(remoteSha(recordRef("gh-11"))).toBeNull();
    h.remote.prs.push({ number: 111, url: "https://github.com/o/r/pull/111", state: "open", is_draft: true, head_sha: "", head: s.branch, base_branch: "main", merged_at: null });
    await bTick();

    const v = await view("gh-11");
    const head = remoteSha(`refs/heads/${s.branch}`) as string;
    expect(v.record).toBeNull();
    expect(v.head?.sha).toBe(head);
    expect(v.last_boundary).toBe("implement");
    expect(v.pr).toMatchObject({ number: 111, state: "open", is_draft: true });

    const md = (await B.norn("story", "view", "gh-11")).stdout;
    expect(md).toContain("Held by: tester@box");
    expect(md).toContain(`heartbeat ${minute(v.renewed_at)}`);
    expect(md).toContain(`expires ${minute(v.expires_at)}`);
    expect(md).toContain(`${s.branch} at ${head.slice(0, 7)} "norn: gh-11 implement.done → review"`);
    expect(md).toContain("last boundary: implement");
    expect(md).toContain("#111 draft, open — https://github.com/o/r/pull/111");
    expect(md).toContain(`run state is on tester@box's machine — ask them to run norn story handoff gh-11, or take it over after the claim expires (${minute(v.expires_at)})`);
    expect(md).not.toContain("attempt");
    expect(md).not.toContain("counters");
    expect(md).not.toContain("review_loop");
  });

  test("AC4: no boundary commit yet: 'no boundary pushed yet' where the last step would be", async () => {
    await storyOnA(12, "not-yet", false);
    await bTick();
    const v = await view("gh-12");
    expect(v.last_boundary).toBeNull();
    const md = (await B.norn("story", "view", "gh-12")).stdout;
    expect(md).toContain("no boundary pushed yet");
    expect(md).not.toContain("last boundary:");
    expect((await B.norn("status")).stdout).toMatch(/gh-12 .*no boundary pushed yet/);
  });
});

describe("the tick fetches only the record refs it needs (B30)", () => {
  test("AC5: gh-9 held by A, gh-10 held by B, a closed gh-4 with a ref: B's local refs hold refs/norn/runs/gh-9 only; views run no fetch", async () => {
    // gh-4 finished long ago: its record is on the remote, its claim is gone
    sh(h.root, ["push", "-q", "origin", `${remoteSha(recordRef("gh-9"))}:${recordRef("gh-4")}`]);
    expect(remoteSha(recordRef("gh-4"))).not.toBeNull();
    // gh-10 is B's own: B intakes and claims it
    h.remote.issues = [...h.remote.issues, issue(10, "b-holds")];
    for (let i = 0; i < 3; i++) await bTick();
    expect(sh(h.dir, ["ls-remote", h.remoteDir, "refs/norn/claims/gh-10"])).not.toBe("");
    expect((await view("gh-9")).holder).toBe("tester@box");

    const records = sh(B.root, ["for-each-ref", "--format=%(refname)", "refs/norn/runs/"]).split("\n").filter(Boolean);
    expect(records).toEqual([recordRef("gh-9")]);

    const spawned: string[][] = [];
    const prev = setSpawnObserver((s) => void spawned.push([...s.argv]));
    try {
      expect((await B.norn("story", "view", "gh-9")).stdout).toContain("Step: review (attempt 1)");
      expect((await B.norn("status")).exit).toBe(0);
    } finally {
      setSpawnObserver(prev);
    }
    expect(spawned.length).toBeGreaterThan(0);
    expect(spawned.filter((a) => a.includes("fetch") || a.includes("ls-remote") || a.includes("push"))).toEqual([]);
    // the record is unpacked once per record commit into the machine dir's cache
    const sha = sh(B.root, ["rev-parse", recordRef("gh-9")]);
    expect(readdirSync(join(recordCacheDir(B.root, "gh-9", sha), ".."))).toEqual([sha]);
  });
});
