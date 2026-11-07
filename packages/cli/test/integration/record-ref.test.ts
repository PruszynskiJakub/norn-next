/**
 * The team's `record.policy`. Under `remote` the holder pushes a
 * story's record, its run-state folder in the machine dir packed into one commit, to
 * `refs/norn/runs/<story>` after the branch; under `local` (the default) no ref leaves the machine.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { recordRef } from "@norn/schema";
import { REPO_CONFIG_FILE, repoConfigPath, unpackRecord, workflowsDir } from "@norn/store";
import type { CliResult, TickReport } from "../../src/index.ts";
import { createHarness, type Harness, issue, runChecked, sh, toBranchRunState } from "../../../../test/support/harness.ts";
import { runStateOf, storyRunStateOf } from "../../../../test/support/run-state.ts";

setDefaultTimeout(90_000);

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
const BASE_CONFIG = "provider: gh\nworkflow: trio\nmode: manual\n";

let h: Harness;
const inWt = (cwd: string, ...argv: string[]): Promise<CliResult> => {
  const env: Record<string, string | undefined> = { ...h.deps.env, NORN_AGENT_PID: String(process.pid) };
  for (const k of ["NORN_AGENT", "NORN_RUN", "NORN_STORY", "NORN_SLICE", "NORN_AGENT_SESSION_ID"]) delete env[k];
  return runChecked(argv, { ...h.deps, cwd, env });
};
const tick = (): Promise<TickReport> => {
  h.clock.advance(10_000);
  return h.tick();
};
async function tickUntil(pred: () => boolean, max = 12) {
  for (let i = 0; i < max && !pred(); i++) await tick();
  expect(pred()).toBe(true);
}
const pushes = (r: TickReport, story: string) => r.decisions.filter((d) => d.unit === story && d.kind === "push_record");
const policy = (p: "local" | "remote" | null) => h.config(`${BASE_CONFIG}${p ? `record:\n  policy: ${p}\n` : ""}`);

/** the record ref on the bare remote; null = none */
const remoteRecord = (story: string): string | null => sh(h.dir, ["ls-remote", h.remoteDir, recordRef(story)]).split(/\s+/)[0] || null;
const remoteBranch = (branch: string): string | null => sh(h.dir, ["ls-remote", h.remoteDir, `refs/heads/${branch}`]).split(/\s+/)[0] || null;
/** every file path under a folder, relative and sorted */
function filesOf(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) (e.isDirectory() ? walk : (p: string) => out.push(relative(dir, p)))(join(d, e.name));
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}
/** the record commit's tree as the remote holds it, and its trailers */
function recordOnRemote(story: string) {
  const sha = remoteRecord(story);
  if (!sha) throw new Error(`no record ref for ${story}`);
  sh(h.dir, ["--git-dir", h.remoteDir, "cat-file", "-e", sha]);
  const files = sh(h.dir, ["--git-dir", h.remoteDir, "ls-tree", "-r", "--name-only", sha]).split("\n").filter(Boolean).sort();
  const trailers = Object.fromEntries(
    sh(h.dir, ["--git-dir", h.remoteDir, "log", "-1", "--format=%(trailers:only,unfold)", sha])
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split(": ") as [string, string]),
  );
  const parents = sh(h.dir, ["--git-dir", h.remoteDir, "log", "-1", "--format=%P", sha]).split(" ").filter(Boolean);
  return { sha, files, trailers, parents };
}

/** A trio story at `step` with its session started (`brief`). */
async function storyAt(n: number, slug: string, step: "implement" | "review") {
  const spec = `.agents/specs/gh-${n}-${slug}`;
  const wt = `${h.root}-worktrees/gh-${n}-${slug}`;
  const runs = () => runStateOf(join(wt, spec));
  h.remote.issues = [...h.remote.issues, issue(n, slug)];
  await h.tick("--sync");
  await tickUntil(() => h.state(runs())?.step === "implement");
  expect((await inWt(wt, "brief")).exit).toBe(0);
  await tick();
  const s = { key: `gh-${n}`, spec, wt, branch: `gh-${n}-${slug}`, runs, record: () => storyRunStateOf(join(wt, spec)) };
  if (step === "review") await finish(s, "done", "review");
  return s;
}
type Story = Awaited<ReturnType<typeof storyAt>>;
/** report `outcome` and tick until the story's next step has its session started */
async function finish(s: Story, outcome: string, next: string): Promise<TickReport[]> {
  h.write(join(s.wt, "src", `${s.key}-${outcome}.ts`), `export const x = "${outcome}";\n`);
  expect((await inWt(s.wt, "done", outcome, "--handoff", outcome)).exit).toBe(0);
  const reports: TickReport[] = [];
  for (let i = 0; i < 12 && h.state(s.runs())?.step !== next; i++) reports.push(await tick());
  expect(h.state(s.runs())?.step).toBe(next);
  if (next !== "$done") {
    expect((await inWt(s.wt, "brief")).exit).toBe(0);
    reports.push(await tick());
  }
  return reports;
}

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  policy(null);
  h.write(join(workflowsDir(h.root), "trio.yaml"), TRIO);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
});
afterAll(() => h.cleanup());

describe("record.policy", () => {
  test("AC1: absent = local; config set writes the team file, config get names it, doctor fails an unknown value", async () => {
    const got = await h.norn("config", "get", "record.policy", "--json");
    expect(got.exit).toBe(0);
    expect(JSON.stringify(got.value)).toContain('"local"');
    expect(JSON.stringify(got.value)).toContain("built-in");

    const set = await h.norn("config", "set", "record.policy", "remote", "--repo");
    expect(set.exit).toBe(0);
    expect(h.read(repoConfigPath(h.root))).toMatch(/record:\s*\n\s+policy: remote/);
    const after = await h.norn("config", "get", "record.policy");
    expect(after.exit).toBe(0);
    expect(after.stdout).toContain("remote");
    expect(after.stdout).toContain(REPO_CONFIG_FILE);

    h.config(`${BASE_CONFIG}record:\n  policy: everywhere\n`);
    const doctor = await h.norn("doctor", "--json");
    expect(doctor.exit).not.toBe(0);
    expect(doctor.stdout).toContain("`record.policy` must be local or remote");
    const bad = await h.norn("config", "set", "record.policy", "sometimes", "--repo");
    expect(bad.exit).not.toBe(0);
    policy(null);
  });

  test("AC1 (review F8): a story run without the key behaves as local: no ref leaves the machine", async () => {
    policy(null);
    const s = await storyAt(8, "no-key", "implement");
    const reports = await finish(s, "done", "review");
    expect(reports.flatMap((r) => pushes(r, "gh-8"))).toEqual([]);
    expect(remoteRecord("gh-8")).toBeNull();
  });
});

describe("under remote, every boundary pushes the record after the branch (B10)", () => {
  let s: Story;
  test("AC2: implement ends: branch, then refs/norn/runs/gh-9 holding the run-state folder, with trailers and a parent", async () => {
    policy("remote");
    s = await storyAt(9, "push-it", "implement");
    const before = remoteRecord("gh-9");
    expect(before).not.toBeNull();
    const reports = await finish(s, "done", "review");
    expect(reports.flatMap((r) => pushes(r, "gh-9")).some((d) => d.ok)).toBe(true);
    const rec = recordOnRemote("gh-9");
    // the tree is the story's run-state folder as in the machine dir: _story/rounds/NN-<wf>/…
    expect(rec.files).toEqual(filesOf(s.record()));
    expect(rec.files).toContain("_story/rounds/01-trio/state.json");
    expect(rec.trailers).toEqual({ "Norn-Story": "gh-9", "Norn-Branch-Commit": remoteBranch(s.branch) as string, "Norn-Holder": expect.any(String) });
    // a chain: the parent is the previous record commit
    expect(rec.parents).toHaveLength(1);
    sh(h.dir, ["--git-dir", h.remoteDir, "merge-base", "--is-ancestor", before as string, rec.sha]);
  });

  test("AC6: a boundary whose record did not change pushes nothing", async () => {
    const sha = remoteRecord("gh-9");
    const r = await tick();
    expect(pushes(r, "gh-9")).toEqual([]);
    expect(remoteRecord("gh-9")).toBe(sha);
  });

  test("D3: another clone unpacks the record into a folder, every JSON validated", async () => {
    const other = join(h.dir, "unpacker");
    sh(h.dir, ["clone", "-q", h.remoteDir, other]);
    sh(other, ["fetch", "-q", "origin", `+${recordRef("gh-9")}:${recordRef("gh-9")}`]);
    const dest = join(mkdtempSync(join(h.dir, "unpack-")), "gh-9");
    const sha = sh(other, ["rev-parse", recordRef("gh-9")]);
    expect(unpackRecord(other, sha, dest)).toMatchObject({ ok: true });
    expect(filesOf(dest)).toEqual(recordOnRemote("gh-9").files);
    expect(h.read(join(dest, "_story/rounds/01-trio/state.json"))).toBe(h.read(join(s.record(), "_story/rounds/01-trio/state.json")));

    // a record whose state fails validation is not put in place
    const blob = sh(other, ["hash-object", "-w", "--stdin"], "{ not json");
    const tree = sh(other, ["mktree"], `100644 blob ${blob}\tstate.json\n`);
    const top = sh(other, ["mktree"], `040000 tree ${tree}\t01-bad\n`);
    const bad = sh(other, ["commit-tree", top, "-m", "bad"]);
    const badDest = join(h.dir, "unpack-bad", "gh-9");
    const r = unpackRecord(other, bad, badDest);
    expect(r.ok).toBe(false);
    expect(existsSync(badDest)).toBe(false);
  });

  test("AC6: a push with a lease on a sha the remote no longer holds is refused and the ref is kept", async () => {
    // another checkout pushes its own record commit on top of the one this checkout saw
    const other = join(h.dir, "rival");
    sh(h.dir, ["clone", "-q", h.remoteDir, other]);
    sh(other, ["fetch", "-q", "origin", `+${recordRef("gh-9")}:${recordRef("gh-9")}`]);
    const seen = sh(other, ["rev-parse", recordRef("gh-9")]);
    const theirs = sh(other, ["commit-tree", `${seen}^{tree}`, "-p", seen, "-m", "norn: record gh-9 (rival)"]);
    sh(other, ["push", "-q", "origin", `${theirs}:${recordRef("gh-9")}`]);

    const reports = await finish(s, "approve", "qa");
    const tried = reports.flatMap((r) => pushes(r, "gh-9"));
    expect(tried.length).toBeGreaterThan(0);
    expect(tried.every((d) => !d.ok)).toBe(true);
    expect(remoteRecord("gh-9")).toBe(theirs);
    // the step goes on
    expect(h.state(s.runs())).toMatchObject({ step: "qa", status: "running" });
  });
});

describe("under local, a normal step pushes no ref (B11)", () => {
  test("AC3: implement, review and qa leave no refs/norn/runs/gh-10 on the remote", async () => {
    policy("local");
    const s = await storyAt(10, "stay-home", "implement");
    await finish(s, "done", "review");
    await finish(s, "approve", "qa");
    await finish(s, "pass", "$done");
    const listed = sh(h.dir, ["ls-remote", h.remoteDir, "refs/norn/runs/*"]);
    expect(listed).not.toContain(recordRef("gh-10"));
  });
});

describe("a policy change applies from the next boundary (B12)", () => {
  test("AC4: local → remote while gh-11 is in review: the next boundary pushes the ref, and every one after", async () => {
    policy("local");
    const s = await storyAt(11, "switch-over", "review");
    expect(remoteRecord("gh-11")).toBeNull();
    policy("remote");
    const r = await tick();
    expect(pushes(r, "gh-11").map((d) => d.ok)).toEqual([true]);
    const first = remoteRecord("gh-11");
    expect(recordOnRemote("gh-11").files).toEqual(filesOf(s.record()));
    await finish(s, "approve", "qa");
    const second = recordOnRemote("gh-11");
    expect(second.sha).not.toBe(first);
    expect(second.files).toEqual(filesOf(s.record()));
    expect(second.trailers["Norn-Branch-Commit"]).toBe(remoteBranch(s.branch) as string);
  });
});

describe("a failed ref push is retried at the next tick (B14)", () => {
  test("AC5: the remote rejects the ref once; the branch is pushed, the step goes on, the next tick pushes the ref", async () => {
    policy("remote");
    const s = await storyAt(12, "blip", "implement");
    const hook = join(h.remoteDir, "hooks", "pre-receive");
    const once = join(h.dir, "rejected-once");
    writeFileSync(
      hook,
      `#!/bin/sh\nwhile read old new ref; do\n  case "$ref" in refs/norn/runs/gh-12) if [ ! -e "${once}" ]; then touch "${once}"; echo "record refused once" >&2; exit 1; fi;; esac\ndone\nexit 0\n`,
    );
    chmodSync(hook, 0o755);
    const before = remoteRecord("gh-12");
    try {
      h.write(join(s.wt, "src", "blip.ts"), "export const x = 1;\n");
      expect((await inWt(s.wt, "done", "done", "--handoff", "built")).exit).toBe(0);
      let failed: TickReport | undefined;
      for (let i = 0; i < 6 && !existsSync(once); i++) failed = await tick();
      expect(existsSync(once)).toBe(true);
      expect(pushes(failed as TickReport, "gh-12").map((d) => d.ok)).toEqual([false]);
      expect(remoteRecord("gh-12")).toBe(before);
      // the branch is pushed and the step goes on
      expect(remoteBranch(s.branch)).toBe(sh(s.wt, ["rev-parse", "HEAD"]));
      expect(h.state(s.runs())?.step).toBe("review");

      const next = await tick();
      expect(pushes(next, "gh-12").map((d) => d.ok)).toEqual([true]);
      expect(remoteRecord("gh-12")).not.toBe(before);
      expect(recordOnRemote("gh-12").files).toEqual(filesOf(s.record()));
    } finally {
      rmSync(hook, { force: true });
    }
  });
});

describe("the record follows the branch (review F1, F5)", () => {
  test("F1: under core.autocrlf=input a CRLF file in the record is packed as it is; the next tick pushes nothing", async () => {
    policy("remote");
    h.git(["config", "core.autocrlf", "input"]);
    try {
      const s = await storyAt(14, "crlf", "implement");
      h.write(join(s.record(), "_story", "notes.txt"), "line one\r\nline two\r\n");
      await finish(s, "done", "review");
      const rec = recordOnRemote("gh-14");
      expect(rec.files).toEqual(filesOf(s.record()));
      expect(sh(h.dir, ["--git-dir", h.remoteDir, "cat-file", "blob", `${rec.sha}:_story/notes.txt`])).toBe("line one\r\nline two");
      const r = await tick();
      expect(pushes(r, "gh-14")).toEqual([]);
      expect(remoteRecord("gh-14")).toBe(rec.sha);
    } finally {
      h.git(["config", "--unset", "core.autocrlf"]);
    }
  });

  test("F5: while this tick's branch push fails the record waits; it follows the branch once that is pushed", async () => {
    policy("remote");
    const s = await storyAt(15, "branch-first", "implement");
    const before = remoteRecord("gh-15");
    const hook = join(h.remoteDir, "hooks", "pre-receive");
    writeFileSync(hook, `#!/bin/sh\nwhile read old new ref; do\n  case "$ref" in refs/heads/${s.branch}) echo "branch refused" >&2; exit 1;; esac\ndone\nexit 0\n`);
    chmodSync(hook, 0o755);
    try {
      h.write(join(s.wt, "src", "first.ts"), "export const x = 1;\n");
      expect((await inWt(s.wt, "done", "done", "--handoff", "built")).exit).toBe(0);
      const r = await tick();
      expect(remoteBranch(s.branch)).not.toBe(sh(s.wt, ["rev-parse", "HEAD"]));
      const tried = pushes(r, "gh-15");
      expect(tried.map((d) => d.ok)).toEqual([false]);
      expect(tried[0]?.error).toContain("is not on origin as it is here");
      expect(remoteRecord("gh-15")).toBe(before);
    } finally {
      rmSync(hook, { force: true });
    }
    // the branch goes out with the story's next boundary commit, and the record right after it
    expect((await inWt(s.wt, "brief")).exit).toBe(0);
    await tick();
    await finish(s, "approve", "qa");
    expect(remoteBranch(s.branch)).toBe(sh(s.wt, ["rev-parse", s.branch]));
    const rec = recordOnRemote("gh-15");
    expect(rec.sha).not.toBe(before);
    expect(rec.trailers["Norn-Branch-Commit"]).toBe(remoteBranch(s.branch) as string);
  });
});

describe("a moved open story pushes its record under remote (B34)", () => {
  test("AC7: the first tick moves runs/ off the branch, pushes the branch, then refs/norn/runs/gh-13 with the moved record", async () => {
    policy("local");
    const s = await storyAt(13, "old-layout", "review");
    const before = h.state(s.runs());
    toBranchRunState(s.wt, s.spec, "_story", { push: "origin" });
    expect(h.state(s.runs())).toBeNull();
    policy("remote");
    expect(remoteRecord("gh-13")).toBeNull();

    const r = await tick();
    expect(r.decisions.filter((d) => d.unit === "gh-13" && d.kind !== "noop").map((d) => `${d.kind} ${d.ok}`)).toEqual(["move_record true", "push_record true"]);
    expect(h.state(s.runs())).toEqual(before);
    const rec = recordOnRemote("gh-13");
    expect(rec.files).toEqual(filesOf(s.record()));
    expect(rec.files).toContain("_story/rounds/01-trio/state.json");
    // the handoff moved to handoffs/ on the branch: it is no part of the record
    expect(rec.files.filter((f) => f.endsWith("handoff.md") || f.startsWith("handoffs/"))).toEqual([]);
    expect(sh(s.wt, ["log", "-1", "--format=%s", rec.trailers["Norn-Branch-Commit"] as string])).toBe("norn: move gh-13 run state off the branch");
    expect(remoteBranch(s.branch)).toBe(rec.trailers["Norn-Branch-Commit"] as string);
  });
});
