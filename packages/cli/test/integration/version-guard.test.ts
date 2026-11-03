/**
 * gh-61 B5–B10, B12 (D1, D2): a binary that does not match the main checkout's `norn_version` is refused
 * by every command that acts (exit 3, `version_mismatch`, before it writes, launches or pushes anything);
 * reading, setup and reporting commands keep working; a repo without the key works as today; a config
 * error comes first. Driven through `runCli` with the harness, as a binary of any version (S1).
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { localConfigPath, REPO_CONFIG_FILE, repoConfigPath, storyUnitDir, workflowsDir } from "@norn/store";
import type { CliResult, TickReport } from "../../src/index.ts";
import { COMMANDS, NOUNS } from "../../src/commands/index.ts";
import { version as PACKAGE_VERSION } from "../../package.json";
import { createHarness, type Harness, issue, runChecked } from "../../../../test/support/harness.ts";

setDefaultTimeout(30_000);

const WORKFLOW = `name: ship
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: test }
  test:
    type: check
    run: CHECK
    timeout: 1m
    outcomes: { pass: $done, fail: $stuck }
`;
const CONFIG = `provider: gh
workflow: ship
mode: manual
`;

/** `norn …` as a binary of `version`, from `cwd` (default the main checkout) */
const as = (h: Harness, version: string, argv: string[], cwd = h.root): Promise<CliResult> => runChecked(argv, { ...h.deps, cwd, version });

/** set (or, with null, remove) `norn_version` in a team file, as a pull or a hand edit would */
function setVersion(file: string, v: string | null): void {
  const kept = readFileSync(file, "utf8").replace(/^norn_version:.*\n?/m, "");
  writeFileSync(file, v === null ? kept : `${kept}norn_version: ${v}\n`);
}

async function setUp(h: Harness, check = "true"): Promise<void> {
  expect((await h.norn("init")).exit).toBe(0);
  h.config(CONFIG);
  h.write(join(workflowsDir(h.root), "ship.yaml"), WORKFLOW.replace("CHECK", JSON.stringify(check)));
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn"]);
  h.git(["push", "-q", "origin", "main"]);
}

const worktree = (h: Harness, n: number, slug: string) => `${h.root}-worktrees/gh-${n}-${slug}`;
const runsOf = (h: Harness, n: number, slug: string) => storyUnitDir(join(worktree(h, n, slug), `.agents/specs/gh-${n}-${slug}`));
const receipts = (dir: string) => (existsSync(join(dir, "receipts")) ? readdirSync(join(dir, "receipts")).sort() : []);

async function tickUntil(h: Harness, pred: () => boolean, max = 10): Promise<void> {
  for (let i = 0; i < max && !pred(); i++) {
    h.clock.advance(10_000);
    await h.tick();
  }
  expect(pred()).toBe(true);
}

const NEEDS_019 = { error: "this repo needs norn 0.19.x (you run 0.18.1)", do_instead: "install norn 0.19.x", code: "version_mismatch" };

describe("commands that act refuse a mismatched binary (B6, B7, D1, D2)", () => {
  let h: Harness;
  const team = () => repoConfigPath(h.root);

  beforeAll(async () => {
    h = await createHarness();
    await setUp(h);
    h.remote.issues = [issue(3, "Add totals")];
    setVersion(team(), "0.19.0");
  });
  afterAll(() => h.cleanup());

  test("AC1: tick as 0.18.1 in a repo at 0.19.0 is refused, exit 3, and nothing is written, launched or pushed", async () => {
    const remoteRefs = h.git(["ls-remote", h.remoteDir]);
    const r = await as(h, "0.18.1", ["tick"]);
    expect(r.exit).toBe(3);
    expect(r.value).toMatchObject(NEEDS_019);
    expect(existsSync(`${h.root}-worktrees`)).toBe(false);
    expect(existsSync(runsOf(h, 3, "add-totals"))).toBe(false);
    expect(h.runner.launches).toEqual([]);
    expect(h.git(["ls-remote", h.remoteDir])).toBe(remoteRefs);
    expect(h.git(["status", "--porcelain"])).toBe(`M ${REPO_CONFIG_FILE}`);

    // the same tick from a matching binary acts: it takes the issue in
    h.clock.advance(10_000);
    expect((await as(h, "0.19.3", ["tick"])).exit).toBe(0);
    expect(await h.listed("gh-3")).toBeDefined();
  });

  test("AC2: every acts command is refused the same way on a mismatch", async () => {
    const argv: Record<string, string[]> = {
      tick: ["tick"],
      watch: ["watch", "--max-ticks", "1"],
      sync: ["sync"],
      brief: ["brief"],
      tidy: ["tidy"],
      "config set": ["config", "set", "mode", "auto", "--local"],
      "config unset": ["config", "unset", "mode", "--local"],
      "story start": ["story", "start", "gh-3"],
      "story approve": ["story", "approve", "gh-3"],
      "story reject": ["story", "reject", "gh-3", "--reason", "no"],
      "story answer": ["story", "answer", "gh-3", "yes"],
      "story edit": ["story", "edit", "gh-3", "--auto"],
      "story take": ["story", "take", "gh-3"],
      "story create": ["story", "create", "--title", "More"],
      "story close": ["story", "close", "gh-3", "--yes"],
      "story reopen": ["story", "reopen", "gh-3"],
      "story reset": ["story", "reset", "gh-3", "--yes"],
      "story checkout": ["story", "checkout", "gh-3"],
      "story update-branch": ["story", "update-branch", "gh-3"],
      "story chat": ["story", "chat", "gh-3"],
      "story handoff": ["story", "handoff", "gh-3"],
      "run rerun": ["run", "rerun", "gh-3"],
      "run cancel": ["run", "cancel", "gh-3"],
      "run attach": ["run", "attach", "gh-3"],
    };
    const acting = [...COMMANDS, ...NOUNS.flatMap((n) => n.verbs)].filter((c) => c.version === "acts").map((c) => c.name);
    expect(Object.keys(argv).sort()).toEqual(acting.sort());
    const local = localConfigPath(h.root);
    const before = readFileSync(local, "utf8");
    const remoteRefs = h.git(["ls-remote", h.remoteDir]);
    const launches = h.runner.launches.length;
    for (const [name, a] of Object.entries(argv)) {
      const r = await as(h, "0.18.1", [...a, "--json"]);
      expect({ name, exit: r.exit, value: r.value }).toEqual({ name, exit: 3, value: { ...NEEDS_019, details: { repo: "0.19.0", running: "0.18.1" } } });
    }
    expect(readFileSync(local, "utf8")).toBe(before);
    expect(h.git(["ls-remote", h.remoteDir])).toBe(remoteRefs);
    expect(h.runner.launches.length).toBe(launches);
  });

  test("AC2: a person reads the same refusal as markdown", async () => {
    const r = await as(h, "0.18.1", ["config", "set", "mode", "auto", "--local"]);
    expect(r.exit).toBe(3);
    expect(r.stdout).toStartWith("**Refused (version_mismatch):** this repo needs norn 0.19.x (you run 0.18.1)");
    expect(r.stdout).toContain("Do instead: install norn 0.19.x");
  });

  test("AC3: a binary newer than the repo is told to run norn upgrade and commit, or install the repo's norn", async () => {
    setVersion(team(), "0.18.0");
    try {
      const r = await as(h, "0.19.0", ["tick"]);
      expect(r.exit).toBe(3);
      expect(r.value).toMatchObject({
        error: "this repo needs norn 0.18.x (you run 0.19.0)",
        do_instead: "run `norn upgrade` to move this repo to norn 0.19.0 and commit the change, or install norn 0.18.x",
        code: "version_mismatch",
      });
    } finally {
      setVersion(team(), "0.19.0");
    }
  });

  test("AC4: reading, setup and repair commands run on a mismatch, with the exit code a matching binary gets", async () => {
    while (h.state(runsOf(h, 3, "add-totals"))?.step !== "implement") {
      h.clock.advance(10_000);
      expect((await as(h, "0.19.0", ["tick"])).exit).toBe(0);
    }
    const argv = [
      ["help"],
      ["--version"],
      ["doctor"],
      ["status"],
      ["status", "--segment"],
      ["story", "list"],
      ["story", "view", "gh-3"],
      ["story", "wait", "gh-3", "--until", "step=implement", "--timeout", "1s"],
      ["run", "list", "gh-3"],
      ["run", "view", "gh-3"],
      ["config", "list"],
      ["config", "get", "mode"],
      ["init"],
      ["upgrade"],
      ["migrate"],
      ["uninstall"],
    ];
    for (const a of argv) {
      const matching = await as(h, "0.19.0", [...a, "--json"]);
      const mismatched = await as(h, "0.18.1", [...a, "--json"]);
      expect({ a, exit: mismatched.exit }).toEqual({ a, exit: matching.exit });
      expect((mismatched.value as { code?: string } | null)?.code).not.toBe("version_mismatch");
    }
    // story wait was met, so the exit codes compared above were real runs
    expect((await as(h, "0.18.1", ["story", "wait", "gh-3", "--until", "step=implement"])).exit).toBe(0);
  });
});

describe("a step in flight can finish (B10)", () => {
  let h: Harness;
  /** the package's version is the one a spawned `norn check-run` runs as; the next minor does not match it */
  const [maj, min] = PACKAGE_VERSION.split(".");
  const NEXT = `${maj}.${Number(min) + 1}.0`;
  const team = () => repoConfigPath(h.root);
  const go = () => join(h.dir, "go");
  const slugs = { 9: "first", 10: "second", 11: "third" } as const;
  const runs = (n: 9 | 10 | 11) => runsOf(h, n, slugs[n]);
  const wt = (n: 9 | 10 | 11) => worktree(h, n, slugs[n]);
  const agentEnv = () => {
    const e: Record<string, string | undefined> = { ...h.deps.env, NORN_AGENT_PID: String(process.pid) };
    for (const k of ["NORN_AGENT", "NORN_RUN", "NORN_STORY", "NORN_SLICE", "NORN_AGENT_SESSION_ID"]) delete e[k];
    return e;
  };
  const inWt = (n: 9 | 10 | 11, argv: string[], stdin?: string) => runChecked(argv, { ...h.deps, cwd: wt(n), env: agentEnv(), ...(stdin ? { stdin } : {}) });

  beforeAll(async () => {
    h = await createHarness();
    await setUp(h, `while [ ! -f ${go()} ]; do sleep 0.05; done`);
    setVersion(team(), PACKAGE_VERSION);
    h.remote.issues = [issue(9, "First"), issue(10, "Second"), issue(11, "Third")];
    await tickUntil(h, () => ([9, 10, 11] as const).every((n) => h.state(runs(n))?.status === "ready"));
    for (const n of [9, 10, 11] as const) expect((await inWt(n, ["brief"])).exit).toBe(0);
  });
  afterAll(() => {
    writeFileSync(go(), "");
    h.cleanup();
  });

  test("AC5: done, ask, stuck and hook are accepted after the team file moved; the next tick is refused", async () => {
    setVersion(team(), NEXT);
    const payload = JSON.stringify({ session_id: "sess-1", transcript_path: "/tmp/t.jsonl", cwd: wt(9), hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "ls" } });
    expect(await inWt(9, ["hook", "post-tool-use"], payload)).toMatchObject({ exit: 0, value: {} });
    expect((await inWt(9, ["done", "done", "--handoff", "built it"])).exit).toBe(0);
    expect((await inWt(10, ["ask", "which one?"])).exit).toBe(0);
    expect((await inWt(11, ["stuck", "no access"])).exit).toBe(0);
    expect(receipts(runs(9)).at(-1)).toMatch(/-done\.json$/);
    expect(receipts(runs(10)).at(-1)).toMatch(/-ask\.json$/);
    expect(receipts(runs(11)).at(-1)).toMatch(/-stuck\.json$/);
    const r = await h.norn("tick");
    expect(r.exit).toBe(3);
    expect(r.value).toMatchObject({ code: "version_mismatch" });
  });

  test("AC5: a check-run a tick started writes its receipt after the team file moved", async () => {
    setVersion(team(), PACKAGE_VERSION);
    // applies the done, then starts the check (not h.tick(): that waits for the check-run)
    let started = false;
    for (let i = 0; i < 5 && !started; i++) {
      h.clock.advance(10_000);
      const t = await h.norn("tick");
      expect(t.exit).toBe(0);
      started = (t.value as TickReport).decisions.some((d) => d.unit === "gh-9" && d.kind === "run_check");
    }
    expect(started).toBe(true);
    expect(receipts(runs(9)).at(-1)).toMatch(/-done\.json$/);
    setVersion(team(), NEXT);
    writeFileSync(go(), "");
    await h.checksDone();
    expect(receipts(runs(9)).at(-1)).toMatch(/-check\.json$/);
    expect((await h.norn("tick")).exit).toBe(3);
  });
});

describe("the main checkout's team file decides (B12), no key works as today (B5), a config error comes first (B3)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness({ version: "0.18.1" });
    await setUp(h);
    h.remote.issues = [issue(5, "Thing")];
  });
  afterAll(() => h.cleanup());

  test("AC7: without the key every command runs as before", async () => {
    await tickUntil(h, () => h.state(runsOf(h, 5, "thing"))?.status === "ready");
    expect((await h.norn("config", "set", "mode", "manual", "--local")).exit).toBe(0);
    expect((await as(h, "0.18.1", ["brief"], worktree(h, 5, "thing"))).exit).toBe(0);
  });

  test("AC6: a version on the remote's base does not count until the main checkout pulls it", async () => {
    const other = join(h.dir, "other");
    h.git(["clone", "-q", h.remoteDir, other], h.dir);
    setVersion(repoConfigPath(other), "0.19.0");
    h.git(["-c", "user.email=o@example.com", "-c", "user.name=Other", "commit", "-qam", "needs 0.19"], other);
    h.git(["push", "-q", "origin", "main"], other);

    h.clock.advance(10_000);
    expect((await h.norn("tick")).exit).toBe(0); // fetched, not pulled
    h.git(["pull", "-q", "--ff-only", "origin", "main"]);
    const r = await h.norn("tick");
    expect(r.exit).toBe(3);
    expect(r.value).toMatchObject(NEEDS_019);
  });

  test("AC6: a unit worktree's own team file is never what the guard reads", async () => {
    const wtTeam = repoConfigPath(worktree(h, 5, "thing"));
    // the main checkout needs 0.19, the worktree's own file records nothing: still refused
    setVersion(wtTeam, null);
    expect((await as(h, "0.18.1", ["brief", "--json"], worktree(h, 5, "thing"))).value).toMatchObject({ code: "version_mismatch" });
    // the main checkout has no key, the worktree's file records 0.19: not refused
    setVersion(repoConfigPath(h.root), null);
    setVersion(wtTeam, "0.19.0");
    expect((await as(h, "0.18.1", ["brief"], worktree(h, 5, "thing"))).exit).toBe(0);
  });

  test("AC7: an invalid key, or a mismatch beside another config problem, is the config error (exit 6), not the version refusal", async () => {
    setVersion(repoConfigPath(h.root), "banana");
    const bad = await h.norn("tick");
    expect(bad.exit).toBe(6);
    expect(bad.value).toMatchObject({ code: "config_invalid" });

    setVersion(repoConfigPath(h.root), "0.19.0");
    writeFileSync(repoConfigPath(h.root), `${readFileSync(repoConfigPath(h.root), "utf8")}bogus: 1\n`);
    const both = await h.norn("tick");
    expect(both.exit).toBe(6);
    expect(both.value).toMatchObject({ code: "config_invalid" });
  });
});
