/**
 * End to end through the CLI runtime (H1, GR2, W2, S4–S9, C5, K4–K6, O3, O4): init → intake →
 * ticks with simulated agent receipts → slice check fail/pass → gate → integrate → open-pr.
 * Real git (temp repo + bare remote); fake RemotePort, RunnerPort and notifier.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TickTrace } from "@norn/schema";
import { loadWorkflows, readTrace, repoConfigPath, workflowsDir } from "@norn/store";
import { replayInputs, type TickReport } from "../src/index.ts";
import { decide } from "@norn/core";
import { createHarness, type Harness, issue } from "./harness.ts";
import { expectTranscript, recordTranscript, type Transcript } from "./transcript.ts";

// whole flows over real git, several ticks each: 5 s is too tight on a loaded machine (full suite)
setDefaultTimeout(30_000);

const MINI = `name: mini
start: plan
steps:
  plan:
    type: agent
    skill: norn-plan
    outcomes: { done: { to: slices, means: "slice files written" } }
  slices:
    type: slices
    outcomes: { done: open-pr, stuck: $stuck }
  open-pr:
    type: git
    action: open-pr
    outcomes: { done: $done }
`;

const SLICE = `name: slice
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: test, means: "tests pass" } }
  test:
    type: check
    run: test -f pass.flag && echo checked
    timeout: 1m
    outcomes: { pass: human-qa, fail: { to: implement, counter: test_loop } }
  human-qa:
    type: gate
    prompt: "Try it"
    outcomes: { approve: integrate, reject: { to: implement, counter: test_loop } }
  integrate:
    type: git
    action: integrate
    outcomes: { done: $done, conflict: { to: implement, counter: test_loop } }
counters: { test_loop: { max: 3 } }
`;

const CONFIG = `agents:
  claude: { adapter: claude }
runner: { adapter: headless }
remote: { provider: gh, label: norn }
default_workflow: story
default_mode: auto
notifiers: []
`;

let h: Harness;
const renewals: string[] = [];
/** decisions that did something, minus claim renewals (T4, timing-dependent) */
const kinds = (r: TickReport) => {
  renewals.push(...r.decisions.filter((d) => d.rule === "claim.renew" && d.ok).map((d) => d.unit));
  return r.decisions.filter((d) => d.kind !== "noop" && d.rule !== "claim.renew").map((d) => `${d.unit} ${d.kind}${d.ok ? "" : ` FAILED ${d.error}`}`);
};

beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.cleanup());

describe("norn init", () => {
  test("writes config, workflows, skills, hooks, .gitignore and .gitattributes; idempotent", async () => {
    const r = await h.norn("init");
    expect(r.exit).toBe(0);
    const v = r.value as { config: string; workflows: { created: string[] }; skills: { updated: string[]; unchanged: string[]; links: Array<{ agent: string; linked: string[] }> }; hooks: Array<{ changed: string[] }>; gitignore: string[]; gitattributes: string[] };
    expect(v.config).toBe("created");
    expect(v.workflows.created).toEqual(["bug.yaml", "slice.yaml", "story.yaml"]);
    expect(v.skills.updated).toContain("norn");
    expect(v.skills.updated).toContain("norn-implement");
    expect(v.skills.links[0]).toMatchObject({ agent: "claude", linked: v.skills.updated });
    expect(v.hooks[0]?.changed).toEqual([join(h.root, ".claude", "settings.json")]);
    expect(v.gitignore).toEqual([".env.norn", ".norn-unit"]);
    expect(v.gitattributes).toEqual([".agents/specs/*/runs/** linguist-generated=true gitlab-generated=true"]);
    // nothing in the repo names a test command: the templates keep theirs, and init says so
    expect(r.value).toMatchObject({ remote: { provider: "gh", label: "norn", git_remote: "origin", url: h.remoteDir }, test_command: { command: "bun test", detected_from: null, set_in: ["bug.yaml", "slice.yaml", "story.yaml"] } });
    expect(r.stdout).toContain("Next steps\n  1. Set your test command:");
    expect(r.stdout).toContain('`git add .agents .claude .gitignore .gitattributes && git commit -m "Set up norn" && git push`');
    expect(r.stdout).toContain("`gh issue create --label norn --assignee @me --title \"…\"`");
    // SK1: one copy in .agents/skills (whole folders), linked from the agent's skill folder
    expect(existsSync(join(h.root, ".agents/skills/norn-review/SMELLS.md"))).toBe(true);
    expect(lstatSync(join(h.root, ".claude/skills/norn-implement")).isSymbolicLink()).toBe(true);
    expect(existsSync(join(h.root, ".claude/skills/norn-implement/SKILL.md"))).toBe(true);
    const again = (await h.norn("init")).value as typeof v;
    expect(again.config).toBe("exists");
    expect(again.gitignore).toEqual([]);
    expect(again.gitattributes).toEqual([]);
    expect(again.hooks[0]?.changed).toEqual([]);
    expect(again.skills.updated).toEqual([]);
  });

  test("prints a summary for a person; --json prints the data", async () => {
    const r = await h.norn("init");
    expect(r.exit).toBe(0);
    expect(r.stdout).toStartWith(`norn init in ${h.root}\n`);
    expect(r.stdout).toContain("config          .agents/norn.config.yaml kept (exists)");
    expect(r.stdout).toContain("workflows       kept bug.yaml, slice.yaml, story.yaml");
    expect(r.stdout).toMatch(/skills +\.agents\/skills: up to date \(\d+ skills\)/);
    expect(r.stdout).toContain("claude → .claude/skills: all linked");
    expect(r.stdout).toContain("hooks           claude: up to date");
    expect(r.stdout).toContain("Nothing changed: norn is set up here.");
    expect(r.stdout).toContain(`remote          origin → ${h.remoteDir}`);
    expect(r.stdout).toContain("Next steps\n  1. Check this machine: `norn doctor`.");
    expect(r.stdout).not.toContain("git commit");
    const json = await h.norn("init", "--json");
    expect(JSON.parse(json.stdout)).toEqual(json.value);
    expect(json.value).toMatchObject({ config: "exists", gitignore: [] });
    // --text, the old opt-in, is still accepted
    expect((await h.norn("init", "--text")).stdout).toBe(r.stdout);
  });

  test("help prints the commands grouped for a person, Core first; --json prints the list", async () => {
    const r = await h.norn("help");
    expect(r.exit).toBe(0);
    expect(r.stdout).toStartWith("norn — deliver software stories");
    expect(r.stdout).toMatch(/\nSetup\n  norn init +Set up norn in this repository: config, workflows, skills, hooks\n/);
    expect(r.stdout).not.toMatch(/\((?:A1|§9\.3)/); // spec ids stay in the JSON
    // an agent that runs help reads first which commands are its own; each command and skill says who it is for
    expect(r.stdout.split("\n")[2]).toStartWith("Agent doing a norn step? Run only `norn brief`");
    expect(r.stdout).toMatch(/\nAgent protocol: the only commands an agent runs\n  norn brief /);
    expect(r.stdout).toMatch(/\n  step skills, a person works with the agent: norn-refine, /);
    const list = (r.value as { commands: Array<{ command: string; summary: string }> }).commands;
    for (const c of list) expect(r.stdout).toContain(`  norn ${c.command} `);
    expect(list.find((c) => c.command === "init")?.summary).toContain("(A1, SK1, W1)");
    const by = (f: string) => list.filter((c) => (c as { for?: string }).for === f).map((c) => c.command);
    expect(by("agent")).toEqual(["brief", "done", "ask", "stuck"]);
    expect(by("hooks")).toEqual([]); // `hook` only in help --all (B3)
    const skills = (r.value as { skills: Array<{ skill: string; for: string }> }).skills;
    expect(skills.find((s) => s.skill === "norn")?.for).toBe("protocol");
    expect(skills.find((s) => s.skill === "norn-qa-person")?.for).toBe("attended");
    for (const s of skills) expect(r.stdout).toContain(s.skill);
    expect(() => JSON.parse(r.stdout)).toThrow();
    expect(JSON.parse((await h.norn("help", "--json")).stdout)).toEqual(r.value);
    // `norn`, `norn --help` and `norn <command> --help` are `norn help`
    expect((await h.norn()).stdout).toBe(r.stdout);
    expect((await h.norn("--help")).stdout).toBe(r.stdout);
    expect(JSON.parse((await h.norn("--help", "--json")).stdout)).toEqual(r.value);
    const watch = await h.norn("watch", "--help");
    expect(watch.stdout).toBe("norn watch — Run ticks in a loop; a clean exit releases held claims\n\n    norn watch [--interval 30s] [--max-ticks N] [--keep-claims] [--human]\n\nFor the person; an agent runs it only when the person asks it to.\n");
    expect((await h.norn("watch", "--help", "--json")).value).toMatchObject({ command: "watch", usage: expect.stringContaining("--interval") });
  });

  test("unknown commands and bad options are usage errors with do_instead", async () => {
    const r = await h.norn("frobnicate");
    expect(r.exit).toBe(2);
    expect(r.value).toMatchObject({ code: "unknown_command", do_instead: expect.stringContaining("norn help") });
    expect((await h.norn("tick", "--bogus")).exit).toBe(2);
    expect((await h.norn("run", "frobnicate")).value).toMatchObject({ error: "Unknown command: run frobnicate", code: "unknown_command", do_instead: expect.stringContaining("norn help run") });
  });

  test("a noun with no verb, and help <noun>, list its verbs in order (B2)", async () => {
    const r = await h.norn("run");
    expect(r.exit).toBe(0);
    expect(r.stdout).toStartWith("norn run — ");
    expect(r.stdout).toMatch(/\n  norn run list +.+\n  norn run view +.+\n  norn run attach +.+\n  norn run rerun +.+\n  norn run cancel +.+\n/);
    expect(r.value).toMatchObject({ command: "run", verbs: [{ command: "run list" }, { command: "run view" }, { command: "run attach" }, { command: "run rerun" }, { command: "run cancel" }] });
    expect((await h.norn("help", "run")).stdout).toBe(r.stdout);
    expect((await h.norn("run", "--help")).stdout).toBe(r.stdout);
    expect((await h.norn("run", "--json")).value).toEqual(r.value);
    // norn help names the noun with its verbs
    expect((await h.norn("help")).stdout).toMatch(/\n  norn run +.*\(list, view, attach, rerun, cancel\)\n/);
  });

  test("help <noun> <verb> and <noun> <verb> --help show that verb's usage and options (B4)", async () => {
    const r = await h.norn("help", "run", "view");
    expect(r.exit).toBe(0);
    expect(r.stdout).toStartWith("norn run view — ");
    expect(r.stdout).toContain("    norn run view ");
    expect(r.stdout).toMatch(/\nOptions\n(?:.*\n)*  --why +.+\n/);
    expect(r.stdout).toMatch(/\n  --receipt <id> +.+\n/);
    expect(r.value).toMatchObject({ command: "run view", options: expect.arrayContaining(["why", "receipt", "tick"]) });
    expect((await h.norn("run", "view", "--help")).stdout).toBe(r.stdout);
    expect((await h.norn("run", "view", "--help", "--json")).value).toEqual(r.value);
  });

  test("help with an unknown name, or a word after a plain command, is a usage error (B5)", async () => {
    for (const args of [["nosuch"], ["init", "extra"]]) {
      const r = await h.norn("help", ...args);
      expect(r.exit).toBe(2);
      expect(r.value).toMatchObject({ error: `Unknown command: ${args.join(" ")}`, code: "unknown_command" });
    }
  });

  test("help --all adds the hidden tier", async () => {
    const all = await h.norn("help", "--all");
    expect(all.exit).toBe(0);
    for (const c of (all.value as { commands: Array<{ command: string }> }).commands) expect(all.stdout).toContain(`  norn ${c.command} `);
  });

  test("the old trace, why, open, mode, workflow, unstick, take, release and drop are unknown commands, and write nothing (B5)", async () => {
    const before = h.git(["status", "--porcelain", "--untracked-files=all", "--ignored"]);
    for (const name of ["trace", "why", "open", "mode", "workflow", "unstick", "take", "release", "drop"]) {
      const r = await h.norn(name, "gh-1");
      expect(r.exit).toBe(2);
      expect(r.value).toMatchObject({ error: `Unknown command: ${name}`, code: "unknown_command", do_instead: expect.stringContaining("norn help") });
    }
    expect(h.git(["status", "--porcelain", "--untracked-files=all", "--ignored"])).toBe(before);
  });

  test("every command accepts --json", async () => {
    const a = await h.norn("status", "--json");
    expect(JSON.parse(a.stdout)).toEqual(a.value);
    const b = await h.norn("uninstall", "--json", "--dry-run");
    expect(b.exit).not.toBe(0);
    expect(JSON.parse(b.stdout)).toMatchObject({ code: "usage" });
  });

  test("--version prints the cli package version", async () => {
    const r = await h.norn("--version");
    expect(r.exit).toBe(0);
    expect(r.value).toEqual({ version: (await Bun.file(join(import.meta.dir, "../package.json")).json()).version });
  });
});

describe("a story through the slice workflow", () => {
  const storyWt = () => `${h.root}-worktrees/gh-7-add-login-form`;
  const sliceWt = () => `${storyWt()}--01-form`;
  const spec = ".agents/specs/gh-7-add-login-form";
  const storyRuns = () => join(storyWt(), spec, "runs/_story");
  const sliceRuns = () => join(sliceWt(), spec, "runs/01-form");
  const step = (ms = 10_000) => h.clock.advance(ms);
  let transcript: Transcript;
  beforeAll(() => {
    transcript = recordTranscript(h);
  });
  afterAll(() => transcript.stop());

  test("setup: repo config and workflows committed on main", async () => {
    h.write(repoConfigPath(h.root), CONFIG);
    h.write(join(workflowsDir(h.root), "mini.yaml"), MINI);
    h.write(join(workflowsDir(h.root), "slice.yaml"), SLICE);
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "norn init"]);
    h.git(["push", "-q", "origin", "main"]);
    h.remote.issues = [issue(7, "Add login form", ["norn", "norn:wf:mini"])];
  });

  test("tick 1: sync → intake (GR2): story branch, worktree, spec.md, slot, marker", async () => {
    const r = await h.tick();
    expect(r.sync).toEqual({ ran: true, ok: true });
    expect(kinds(r)).toEqual(["gh-7 intake_story"]);
    expect(existsSync(join(storyWt(), spec, "spec.md"))).toBe(true);
    const story = h.read(join(storyWt(), spec, "spec.md"));
    expect(story).toContain("workflow: mini");
    expect(story).toContain("status: new");
    expect(story).toContain("As a user I want to log in.");
    expect(h.read(join(storyWt(), ".norn-unit"))).toContain("story=gh-7");
    expect(h.read(join(storyWt(), ".env.norn"))).toContain("NORN_SLOT=1");
    expect(h.git(["log", "-1", "--format=%s%n%(trailers:only)"], storyWt())).toContain("Norn-Story: gh-7");
    expect(h.git(["status", "--porcelain"], storyWt())).toBe("");
    expect(readdirSync(join(h.home, "leases"))).toEqual(["slot-1.json"]);
  });

  test("tick 2: claim acquired (T3); tick 3: story unit started with pinned workflow (S7)", async () => {
    step();
    expect(kinds(await h.tick())).toEqual(["gh-7 claim"]);
    expect(h.git(["ls-remote", "origin", "refs/norn/claims/gh-7"])).toContain("refs/norn/claims/gh-7");
    step();
    expect(kinds(await h.tick())).toEqual(["gh-7 start_unit"]);
    const st = h.state(storyRuns());
    expect(st).toMatchObject({ step: "plan", status: "ready", mode: "auto", workflow: "mini" });
    expect(h.read(join(storyRuns(), "workflow.yaml"))).toBe(MINI);
    expect(h.read(join(storyRuns(), "handoff.md"))).toContain("Step: plan (attempt 1)");
    expect(h.read(join(storyWt(), spec, "spec.md"))).toContain("status: active");
    expect(h.git(["ls-remote", "origin", "refs/heads/gh-7-add-login-form"])).not.toBe("");
  });

  test("tick 4: auto mode launches the agent via the runner with NORN_* env (A6, B5)", async () => {
    step();
    expect(kinds(await h.tick())).toEqual(["gh-7 start_run"]);
    const launch = h.runner.launches[0];
    expect(launch?.cwd).toBe(storyWt());
    expect(launch?.env).toMatchObject({ NORN_STORY: "gh-7", NORN_HOME: h.root, NORN_SLOT: "1" });
    expect(launch?.argv.join(" ")).toContain("Use the norn skill, then run `norn brief`.");
    const st = h.state(storyRuns());
    expect(st?.status).toBe("running");
    expect(st?.run?.session).toEqual({ runner: "fake", session_id: "s-1", pane_id: "p-1", reach: "fake attach p-1" });
    expect(readdirSync(join(storyRuns(), "receipts")).sort()).toEqual(["0001-started.json", "0002-started.json"]);
    expect(readdirSync(join(h.home, "leases")).sort()).toEqual(["agent-1.json", "slot-1.json"]);
    // R2.1 (N6): the started receipts were committed and pushed in the launch tick
    expect(h.git(["show", `origin/gh-7-add-login-form:${spec}/runs/_story/receipts/0002-started.json`])).toContain('"session"');
    // a live run with nothing new: no action (no recover.commit)
    step();
    expect(kinds(await h.tick())).toEqual([]);
  });

  test("plan done → slices step starts the slice: worktree from the story branch, slot 2, slice active (W2, K4)", async () => {
    h.write(join(storyWt(), spec, "slices/01-form.md"), "---\nid: gh-7/01\ntitle: Login form\ndepends_on: []\nstatus: planned\n---\n\nAcceptance: the form renders.\n");
    h.report(storyRuns(), "done", { outcome: "done", handoff: "planned one slice" });
    step();
    expect(kinds(await h.tick())).toEqual(["gh-7 apply_receipts"]);
    expect(h.state(storyRuns())).toMatchObject({ step: "slices", status: "ready" });
    const msg = h.git(["log", "-1", "--format=%B"], storyWt());
    expect(msg).toContain("Norn-Story: gh-7");
    expect(msg).toContain("Norn-Step: plan");
    expect(msg).toMatch(/Norn-Tick: [0-9A-Z]{26}/);
    expect(h.git(["show", "--stat", "--format=", "HEAD"], storyWt())).toContain("slices/01-form.md");
    expect(readdirSync(join(h.home, "leases")).sort()).toEqual(["slot-1.json"]); // agent lease released
    step();
    expect(kinds(await h.tick())).toEqual(["gh-7 start_slices"]);
    expect(existsSync(sliceWt())).toBe(true);
    expect(h.read(join(sliceWt(), ".env.norn"))).toContain("NORN_SLOT=2");
    expect(h.read(join(storyWt(), spec, "slices/01-form.md"))).toContain("status: active");
    expect(h.state(sliceRuns())).toMatchObject({ story: "gh-7", slice: "gh-7/01", step: "implement", status: "ready" });
    expect(h.git(["log", "-1", "--format=%(trailers:only)"], sliceWt())).toContain("Norn-Slice: gh-7/01");
  });

  test("slice implement runs; check fails (C5: receipt tail + committed log) and routes back counted (W4)", async () => {
    step();
    expect(kinds(await h.tick())).toEqual(["gh-7/01 start_run"]);
    expect(h.runner.launches[1]?.env).toMatchObject({ NORN_SLICE: "gh-7/01", NORN_SLOT: "2" });
    h.write(join(sliceWt(), "form.txt"), "form v1\n");
    h.report(sliceRuns(), "done", { outcome: "done", handoff: "form added" });
    step();
    expect(kinds(await h.tick())).toEqual(["gh-7/01 apply_receipts"]);
    expect(h.state(sliceRuns())).toMatchObject({ step: "test", status: "ready" });
    step();
    const r = await h.tick();
    expect(kinds(r)).toEqual(["gh-7/01 run_check"]);
    const files = readdirSync(join(sliceRuns(), "receipts"));
    const checkFile = files.find((f) => f.endsWith("-check.json")) as string;
    const check = JSON.parse(h.read(join(sliceRuns(), "receipts", checkFile)));
    expect(check).toMatchObject({ kind: "check", outcome: "fail", exit_code: 1, command: "test -f pass.flag && echo checked", step: "test", attempt: 1 });
    expect(check.log).toMatch(/^logs\/[0-9A-Z]{26}\.log$/);
    expect(existsSync(join(sliceRuns(), check.log))).toBe(true);
    step();
    expect(kinds(await h.tick())).toEqual(["gh-7/01 apply_receipts"]);
    expect(h.state(sliceRuns())).toMatchObject({ step: "implement", attempt: 2, counters: { test_loop: 1 } });
    expect(h.git(["show", "--stat", "--format=", "HEAD"], sliceWt())).toContain(check.log.slice(5));
  });

  test("rework passes the check; gate parks and notifies once (O3); approve → integrate (K6)", async () => {
    step();
    expect(kinds(await h.tick())).toEqual(["gh-7/01 start_run"]);
    h.write(join(sliceWt(), "pass.flag"), "ok\n");
    h.report(sliceRuns(), "done", { outcome: "done", handoff: "fixed" });
    step();
    await h.tick();
    step();
    expect(kinds(await h.tick())).toEqual(["gh-7/01 run_check"]);
    step();
    // O3: notified in the tick that parked it (post-act facts), not one tick later
    const parked = await h.tick();
    expect(kinds(parked)).toEqual(["gh-7/01 apply_receipts"]);
    expect(h.state(sliceRuns())).toMatchObject({ step: "human-qa", status: "parked", park: { kind: "gate", reason: "Try it" } });
    expect(parked.notified).toEqual(["approve:gh-7/01:human-qa#1"]);
    expect(h.notifier.items.map((i) => i.id)).toContain("approve:gh-7/01:human-qa#1");
    step();
    expect((await h.tick()).notified).toEqual([]);
    h.report(sliceRuns(), "approve", {}, "human");
    step();
    expect(kinds(await h.tick())).toEqual(["gh-7/01 apply_receipts"]);
    expect(h.state(sliceRuns())).toMatchObject({ step: "integrate", status: "ready" });
    step();
    expect(kinds(await h.tick())).toEqual(["gh-7/01 run_git"]);
    expect(h.git(["log", "--format=%s", "gh-7-add-login-form"])).toContain("norn: gh-7/01 implement.done → test");
    expect(existsSync(join(storyWt(), "pass.flag"))).toBe(true);
  });

  test("slice $done → cleanup (K5): final state on the story branch, worktree + branch removed, integrated", async () => {
    step();
    expect(kinds(await h.tick())).toEqual(["gh-7/01 apply_receipts"]);
    expect(h.state(sliceRuns())).toMatchObject({ step: "$done", status: "done" });
    step();
    // the story's slices step sees the slice done in the same tick (W2)
    expect(kinds(await h.tick())).toEqual(["gh-7 classify", "gh-7/01 mark_done"]);
    expect(existsSync(sliceWt())).toBe(false);
    expect(h.git(["branch", "--list", "gh-7/01-form"])).toBe("");
    expect(h.read(join(storyWt(), spec, "slices/01-form.md"))).toContain("status: integrated");
    expect(h.state(join(storyWt(), spec, "runs/01-form"))).toMatchObject({ step: "$done", status: "done" });
    expect(readdirSync(join(h.home, "leases")).sort()).toEqual(["slot-1.json"]);
  });

  test("slices done → open-pr through the RemotePort → story $done; trace replays (O4, O5)", async () => {
    expect(h.state(storyRuns())).toMatchObject({ step: "open-pr", status: "ready" });
    step();
    expect(kinds(await h.tick())).toEqual(["gh-7 run_git"]);
    expect(h.remote.prs).toMatchObject([{ head: "gh-7-add-login-form", base_branch: "main", is_draft: true }]);
    step();
    expect(kinds(await h.tick())).toEqual(["gh-7 apply_receipts"]);
    expect(h.state(storyRuns())).toMatchObject({ step: "$done", status: "done" });
    expect(h.git(["status", "--porcelain"], storyWt())).toBe("");
    expect(h.git(["rev-parse", "gh-7-add-login-form"])).toBe(h.git(["ls-remote", "origin", "refs/heads/gh-7-add-login-form"]).split("\t")[0] as string);

    expect(renewals).toContain("gh-7"); // T4: the beat renewed the claim along the way
    const ticks = readTrace(h.root, { types: ["tick"] }).events as TickTrace[];
    expect(Math.max(...ticks.map((t) => t.duration_ms))).toBeLessThan(5000);
    expect(ticks.length).toBeGreaterThan(20);
    for (const t of ticks.slice(-6)) {
      const inputs = replayInputs(h.root, t);
      expect(inputs).not.toBeNull();
      const replayed = decide(inputs!.facts, inputs!.workflows, inputs!.config);
      expect(replayed.map((d) => d.rule)).toEqual(t.decisions.map((d) => d.rule));
      expect(JSON.parse(JSON.stringify(replayed.map((d) => d.action)))).toEqual(t.decisions.map((d) => d.action));
    }
  });

  test("effect transcript: spawns, port calls and runs/ files of the whole flow (refactor Phase 0.2)", () => {
    expectTranscript(transcript, "e2e-slice-workflow");
  });
});

describe("norn init in a repository with a test command and no remote", () => {
  let f: Harness;
  beforeAll(async () => {
    f = await createHarness();
  });
  afterAll(() => f.cleanup());

  test("writes the detected test command into the workflows and puts adding the remote first", async () => {
    writeFileSync(join(f.root, "package.json"), JSON.stringify({ name: "app", scripts: { test: "vitest run" } }));
    writeFileSync(join(f.root, "package-lock.json"), "{}");
    f.git(["remote", "remove", "origin"]);
    const r = await f.norn("init");
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ remote: { url: null }, test_command: { command: "npm ci && npm test", detected_from: "package.json", set_in: ["bug.yaml", "slice.yaml", "story.yaml"] } });
    const story = readFileSync(join(workflowsDir(f.root), "story.yaml"), "utf8");
    expect(story).toContain('run: "npm ci && npm test"');
    expect(story).not.toContain("run: bun test");
    expect(r.stdout).toContain("remote          no git remote named origin");
    expect(r.stdout).toContain("Next steps\n  1. Add the remote norn syncs issues from and pushes branches to: `git remote add origin <url>`.\n  2. Check the test command `npm ci && npm test`");
    // the edited templates still validate (W5), with the command as the test check's run
    const listing = loadWorkflows(f.root);
    expect(listing.errors).toEqual([]);
    expect(listing.workflows.story?.workflow.steps.test).toMatchObject({ type: "check", run: "npm ci && npm test" });
  });
});
