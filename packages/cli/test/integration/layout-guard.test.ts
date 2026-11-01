/**
 * gh-110 B17–B21 (D4, D5): the code knows one layout. On a main checkout still on the old layout every
 * command refuses and names `norn migrate`; with a part in both places it refuses naming both paths;
 * `doctor` reports it as a failed check; `hook` stays out of the agent's way; and a unit worktree's own
 * old files are never looked at. The old paths are spelled out in the harness: what a person had.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { validate } from "@norn/schema";
import { readTrace, repoConfigPath, workflowsDir, writeUnitMarker, storyUnitDir } from "@norn/store";
import type { CliResult } from "../../src/index.ts";
import { createHarness, type Harness, issue, type LayoutPartName, layoutPlaces, oldNornDir, runChecked, sh, toNewLayout, toOldLayout } from "../../../../test/support/harness.ts";

setDefaultTimeout(60_000);

const CONFIG = `agents:
  claude: { adapter: claude }
remote: { provider: gh, label: norn }
default_workflow: duo
default_mode: manual
notifiers: []
`;

const DUO = `name: duo
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: sign-off, means: "every criterion has a passing test" } }
  sign-off:
    type: gate
    outcomes: { approve: $done, reject: $stuck }
`;

const PARTS: LayoutPartName[] = ["config", "workflows", "machine files"];

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.write(repoConfigPath(h.root), CONFIG);
  h.write(join(workflowsDir(h.root), "duo.yaml"), DUO);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(9, "Started before"), issue(10, "Asks first")];
  // a tick fills the machine dir (trace, heartbeat), so the machine files part has something to move
  h.clock.advance(10_000);
  await h.tick();
});
afterAll(() => h.cleanup());

/** Every file under the checkout (outside `.git`) and under the norn home: what "writes nothing, moves nothing" compares. */
function snapshot(): string[] {
  const list = (dir: string) => (readdirSync(dir, { recursive: true }) as string[]).filter((p) => !p.startsWith(".git/") && p !== ".git").map((p) => join(dir, p));
  return [...list(h.root), ...list(h.home), sh(h.root, ["status", "--porcelain"])].sort();
}

const norn = (...argv: string[]) => h.norn(...argv);
const watchOnce = () => norn("watch", "--max-ticks", "1", "--interval", "1s");

function expectRefused(r: CliResult, code: "old_layout" | "both_layouts") {
  expect(r.exit).toBe(3);
  expect(r.value).toMatchObject({ code });
  expect(validate("cli-error", r.value).ok).toBe(true);
}

describe("old layout: every command refuses and names norn migrate (B18, B19)", () => {
  for (const part of PARTS) {
    describe(`only the ${part} at its old place`, () => {
      beforeAll(() => toOldLayout(h.root, [part]));
      afterAll(() => toNewLayout(h.root));

      test("status, tick and watch refuse (exit 3, old_layout) naming the main checkout, do_instead norn migrate; a CliError with --json", async () => {
        const before = snapshot();
        for (const r of [await norn("status", "--json"), await norn("tick"), await watchOnce()]) {
          expectRefused(r, "old_layout");
          const { error, do_instead } = r.value as { error: string; do_instead: string };
          expect(do_instead).toBe("norn migrate");
          expect(error).toContain(h.root);
          expect(error).toContain(relative(h.root, layoutPlaces(h.root)[part].old));
        }
        const md = await norn("status");
        expect(md.exit).toBe(3);
        expect(md.stdout).toContain("norn migrate");
        expect(snapshot()).toEqual(before);
      });
    });
  }

  test("init refuses with do_instead norn migrate and writes nothing (B19)", async () => {
    toOldLayout(h.root);
    try {
      const before = snapshot();
      const r = await norn("init", "--json");
      expectRefused(r, "old_layout");
      expect(r.value).toMatchObject({ do_instead: "norn migrate" });
      expect(snapshot()).toEqual(before);
    } finally {
      toNewLayout(h.root);
    }
  });
});

describe("both layouts: every command refuses naming both paths, reads and moves nothing (B17)", () => {
  for (const part of PARTS) {
    test(`the ${part} in both places`, async () => {
      const { old, new: now } = layoutPlaces(h.root)[part];
      mkdirSync(join(old, ".."), { recursive: true });
      cpSync(now, old, { recursive: true });
      try {
        const before = snapshot();
        for (const argv of [["status", "--json"], ["tick"], ["story", "list", "--json"], ["config", "list", "--json"]]) {
          const r = await norn(...argv);
          expectRefused(r, "both_layouts");
          const error = (r.value as { error: string }).error;
          expect(error).toContain(relative(h.root, old));
          expect(error).toContain(now.startsWith(h.root) ? relative(h.root, now) : now);
        }
        expect(snapshot()).toEqual(before);
      } finally {
        rmSync(oldNornDir(h.root), { recursive: true, force: true });
      }
    });
  }
});

describe("norn doctor reports the layout as a failed repo check (B20)", () => {
  for (const kind of ["old", "both"] as const) {
    test(`${kind} layout: doctor and doctor --repo fail naming norn migrate and move nothing`, async () => {
      if (kind === "old") toOldLayout(h.root);
      else {
        const { old, new: now } = layoutPlaces(h.root).config;
        mkdirSync(join(old, ".."), { recursive: true });
        cpSync(now, old);
      }
      try {
        const before = snapshot();
        for (const flags of [[], ["--repo"]]) {
          const json = await norn("doctor", ...flags, "--json");
          expect(json.exit).toBe(1);
          expect(json.value).toMatchObject({ ok: false, repo: { ok: false, layout: { ok: false, layout: kind, do_instead: expect.stringContaining("norn migrate") } } });
          const md = await norn("doctor", ...flags);
          expect(md.exit).toBe(1);
          expect(md.stdout).toContain("FAIL layout");
          expect(md.stdout).toContain("norn migrate");
        }
        expect(snapshot()).toEqual(before);
      } finally {
        if (kind === "old") toNewLayout(h.root);
        else rmSync(oldNornDir(h.root), { recursive: true, force: true });
      }
    });
  }
});

describe("old layout in a unit worktree's session (B18, D5)", () => {
  let wt = "";
  beforeAll(() => {
    // a unit marker is all a verb needs to find the repo; the guard refuses before anything else is read
    wt = join(h.dir, "wt-old");
    mkdirSync(wt);
    sh(wt, ["init", "-q"]);
    writeUnitMarker(wt, { repo: h.root, story: "gh-9", slice: null, unit: "_story", spec_dir: ".agents/specs/gh-9-started-before" });
    toOldLayout(h.root);
  });
  afterAll(() => toNewLayout(h.root));

  test("norn hook exits 0, records nothing and blocks nothing", async () => {
    const before = snapshot();
    for (const event of ["stop", "pre-tool-use"]) {
      const r = await runChecked(["hook", event], { ...h.deps, cwd: wt, stdin: JSON.stringify({ session_id: "s", cwd: wt, hook_event_name: event === "stop" ? "Stop" : "PreToolUse", stop_hook_active: false }) });
      expect(r.exit).toBe(0);
      expect(r.value).toEqual({});
    }
    expect(snapshot()).toEqual(before);
  });

  test("brief, done, ask and stuck refuse like any command", async () => {
    for (const argv of [["brief"], ["done", "done", "--handoff", "x"], ["ask", "q?"], ["stuck", "r"]]) {
      const r = await runChecked([...argv, "--json"], { ...h.deps, cwd: wt });
      expectRefused(r, "old_layout");
      expect(r.value).toMatchObject({ do_instead: "norn migrate" });
    }
  });
});

describe("a unit worktree's own old files are ignored (B21)", () => {
  const wtOf = (n: number, slug: string) => `${h.root}-worktrees/gh-${n}-${slug}`;
  const env = () => {
    const e: Record<string, string | undefined> = { ...h.deps.env, NORN_AGENT_PID: String(process.pid) };
    for (const k of ["NORN_AGENT", "NORN_RUN", "NORN_STORY", "NORN_SLICE", "NORN_AGENT_SESSION_ID"]) delete e[k];
    return e;
  };
  const inWt = (cwd: string, ...argv: string[]) => runChecked(argv, { ...h.deps, cwd, env: env() });

  beforeAll(async () => {
    const ready = (n: number, slug: string) => h.state(storyUnitDir(join(wtOf(n, slug), `.agents/specs/gh-${n}-${slug}`)))?.status === "ready";
    for (let i = 0; i < 10 && !(ready(9, "started-before") && ready(10, "asks-first")); i++) {
      h.clock.advance(10_000);
      await h.tick();
    }
    // each worktree still holds the old layout's files, as a branch cut before the migration does
    for (const w of [wtOf(9, "started-before"), wtOf(10, "asks-first")]) {
      const old = layoutPlaces(w);
      h.write(old.config.old, "default_mode: [not, a, mode]\n");
      h.write(join(old.workflows.old, "duo.yaml"), "name: duo\n");
      h.write(join(old["machine files"].old, "heartbeat.json"), "{}\n");
    }
  });

  test("brief, done and the agent hooks work, reading config and workflows from the main checkout", async () => {
    const wt = wtOf(9, "started-before");
    const brief = await inWt(wt, "brief", "--json");
    expect(brief.exit).toBe(0);
    expect(brief.value).toMatchObject({ unit: "gh-9", step: "implement" });
    const hook = await runChecked(["hook", "stop"], { ...h.deps, cwd: wt, env: env(), stdin: JSON.stringify({ session_id: "s9", cwd: wt, hook_event_name: "Stop", stop_hook_active: false }) });
    expect(hook.exit).toBe(0);
    expect(readTrace(h.root, { types: ["hook"] }).events.length).toBeGreaterThan(0);
    const done = await inWt(wt, "done", "done", "--handoff", "built it", "--json");
    expect(done.exit).toBe(0);
  });

  test("ask works", async () => {
    const wt = wtOf(10, "asks-first");
    expect((await inWt(wt, "brief", "--json")).exit).toBe(0);
    const ask = await inWt(wt, "ask", "which way?", "--json");
    expect(ask.exit).toBe(0);
  });
});
