/**
 * Prompts and launches end to end (SPEC-auto-mode-recovery §4 acceptance 9, 11, 12):
 *   - R6.1: an implicit ask (a prompt in the agent's pane) does not refuse the agent's report — the
 *     report is accepted behind an `answer` receipt `by: "agent"`
 *   - R6.2: `norn answer` types the option number + enter into the prompt, then writes the receipt
 *     (`delivered`), which the tick does not type again
 *   - R6.3: a delivery that fails writes no receipt, keeps the unit parked, and the Answer item
 *     names how to reach the pane
 *   - B6/B11: a report after a person's answer is accepted; a tick racing the agent's own answer is
 *     superseded, not failed
 *   - R8.1: the launch command puts the norn shim first on PATH inside the command, NORN_BIN set —
 *     through a launcher file, so the typed command stays short (B2)
 *   - R9.1: SessionStart without a turn start → one re-send, then `silent` "launch prompt not received"
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { herdr, proc } from "@norn/adapters";
import { AUTO_PROMPT, type Inbox } from "@norn/core";
import { type Receipt, type UnitState, ulid } from "@norn/schema";
import { appendHookTrace, repoConfigPath, workflowsDir, storyUnitDir } from "@norn/store";
import type { TickReport } from "../../src/index.ts";
import { withNornOnPath } from "../../src/runtime/shim.ts";
import { runCli } from "../../src/index.ts";
import { createHarness, type Harness, issue } from "../../../../test/support/harness.ts";
import { runChecked } from "../../../../test/support/harness.ts";

// whole flows over real git, several ticks each: 5 s is too tight on a loaded machine (full suite)
setDefaultTimeout(30_000);

const SOLO = `name: solo
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: $done }
`;
const CONFIG = `agents:
  claude: { adapter: claude }
runner: { adapter: herdr }
remote: { provider: gh, label: norn }
default_workflow: solo
default_mode: auto
`;
/** A recorded Claude Code permission dialog in a herdr pane (packages/adapters/test/herdr/fixtures), trimmed. */
const SCREEN = [
  " Bash command",
  "",
  " │ cat >> test/web.test.ts <<'EOF'",
  " │ EOF",
  "╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌",
  " Contains brace with quote character (expansion obfuscation)",
  "",
  " Do you want to proceed?",
  " ❯ 1. Yes",
  "   2. Yes, and switch to auto mode · auto mode handles these prompts for you",
  "   3. No",
  "",
  " Esc to cancel · Tab to amend",
].join("\n");

const SPEC = ".agents/specs/gh-9-fix-the-bug";
const wt = (h: Harness) => `${h.root}-worktrees/gh-9-fix-the-bug`;
const runs = (h: Harness) => storyUnitDir(join(wt(h), SPEC));
const acted = (r: TickReport) => r.decisions.filter((d) => d.kind !== "noop" && d.rule !== "claim.renew").map((d) => `${d.unit} ${d.rule}${d.ok ? "" : ` FAILED ${d.error}`}`);
const receipts = (h: Harness): Receipt[] =>
  readdirSync(join(runs(h), "receipts"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(runs(h), "receipts", f), "utf8")) as Receipt);

async function boot(h: Harness): Promise<void> {
  expect((await h.norn("init")).exit).toBe(0);
  h.write(repoConfigPath(h.root), CONFIG);
  h.write(join(workflowsDir(h.root), "solo.yaml"), SOLO);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(9, "Fix the bug")];
}

async function untilRunning(h: Harness): Promise<UnitState> {
  for (let i = 0; i < 6 && h.state(runs(h))?.status !== "running"; i++) {
    h.clock.advance(10_000);
    await h.tick();
  }
  const st = h.state(runs(h));
  expect(st?.status).toBe("running");
  return st as UnitState;
}

/** The agent's pane shows the permission dialog; one tick parks the unit on it. */
async function parkOnPrompt(h: Harness): Promise<UnitState> {
  const prompt = herdr.parsePanePrompt(SCREEN);
  h.runner.pane = { alive: true, state: "waiting_input", since: null, detail: SCREEN, ...(prompt ? { prompt } : {}) };
  h.clock.advance(10_000);
  expect(acted(await h.tick())).toEqual(["gh-9 agent.ask.implicit"]);
  const st = h.state(runs(h)) as UnitState;
  expect(st).toMatchObject({ status: "parked", park: { kind: "ask", implicit: "pane", reason: "Contains brace with quote character (expansion obfuscation) Do you want to proceed?" } });
  return st;
}

describe("R6.1: the agent's report while parked on an implicit ask (acceptance 9)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    await boot(h);
  });
  afterAll(() => h.cleanup());

  test("the Answer item is the question, the first command line and the options; the screen only with --details", async () => {
    await untilRunning(h);
    await parkOnPrompt(h);
    const inbox = (await h.norn("status")).value as Inbox;
    expect(inbox.groups.answer).toEqual([
      expect.objectContaining({
        title: "Contains brace with quote character (expansion obfuscation) Do you want to proceed?",
        detail: "pending command: cat >> test/web.test.ts <<'EOF' · options: 1. Yes · 2. Yes, and switch to auto mode · auto mode handles these prompts for you · 3. No — answer with the number",
        command: 'norn story answer gh-9 "…"',
      }),
    ]);
    expect(inbox.groups.answer[0]).not.toHaveProperty("full");
    const details = (await h.norn("status", "--details")).value as Inbox;
    expect(details.groups.answer[0]?.full).toBe(SCREEN);
    const text = (await h.norn("status")).stdout as string;
    expect(text).not.toContain("│ EOF");
    expect((await h.norn("status", "--details")).stdout).toContain("      | ╌╌╌");
  });

  test("`norn done` is accepted: an answer by the agent closes the ask, then the report applies", async () => {
    const r = await runChecked(["done", "done", "--handoff", "fixed"], { ...h.deps, cwd: wt(h) });
    expect(r.value).toMatchObject({ ok: true, kind: "done" });
    expect(r.exit).toBe(0);
    const tail = receipts(h).slice(-2);
    expect(tail.map((x) => `${x.kind}:${x.by}`)).toEqual(["answer:agent", "done:agent"]);
    expect(tail[0]).toMatchObject({ answer: "the agent moved on: reported norn done done" });
    h.runner.pane = { alive: true, state: "working", since: null };
    h.clock.advance(10_000);
    const t = await h.tick();
    expect(acted(t)).toEqual(["gh-9 receipts.apply"]);
    expect(h.state(runs(h))).toMatchObject({ step: "$done", status: "done" });
    // nothing was typed into the pane for the agent's own answer
    expect(h.runner.sent).toEqual([]);
  });
});

describe("R6.2/R6.3: norn answer types into the prompt (acceptance 9)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    await boot(h);
  });
  afterAll(() => h.cleanup());

  test("delivery failure: no receipt, still parked, the Answer item names the pane", async () => {
    await untilRunning(h);
    await parkOnPrompt(h);
    const before = receipts(h).length;
    h.runner.keysError = new Error("pane p-1 is gone");
    const r = await h.norn("story", "answer", "gh-9", "1");
    expect(r.exit).toBe(1);
    expect(r.value).toMatchObject({ code: "answer_not_delivered", error: "answer to gh-9 not delivered: pane p-1 is gone", do_instead: "answer it in the pane: fake attach p-1" });
    expect(receipts(h)).toHaveLength(before);
    h.clock.advance(10_000);
    await h.tick();
    expect(h.state(runs(h))).toMatchObject({ status: "parked", park: { kind: "ask" } });
    const inbox = (await h.norn("status")).value as Inbox;
    expect(inbox.groups.answer[0]).toMatchObject({ command: "fake attach p-1", detail: expect.stringContaining("not delivered: answer to gh-9 not delivered: pane p-1 is gone") });
    expect(inbox.groups.unblock).toEqual([]);
  });

  test("not an option of the prompt → usage error, nothing typed", async () => {
    h.runner.keysError = null;
    const r = await h.norn("story", "answer", "gh-9", "maybe");
    expect(r.exit).toBe(2);
    expect(r.value).toMatchObject({ code: "not_an_option", error: expect.stringContaining("1. Yes · 2. Yes, and switch") });
    expect(h.runner.keyed).toEqual([]);
  });

  test("a choice: option number + enter typed, then the receipt (delivered); the tick types nothing again", async () => {
    const r = await h.norn("story", "answer", "gh-9", "3");
    expect(r.exit).toBe(0);
    expect(h.runner.keyed).toEqual([{ session: expect.objectContaining({ pane_id: "p-1" }), keys: [{ text: "3" }, { key: "enter" }] }]);
    expect(receipts(h).at(-1)).toMatchObject({ kind: "answer", by: "human", answer: "3", delivered: true });
    h.runner.pane = { alive: true, state: "working", since: null };
    h.clock.advance(10_000);
    const t = await h.tick();
    expect(acted(t)).toEqual(["gh-9 receipts.apply"]);
    expect(h.state(runs(h))).toMatchObject({ status: "running", park: null });
    expect(h.runner.sent).toEqual([]);
    expect(((await h.norn("status")).value as Inbox).groups.answer).toEqual([]);
  });
});

describe("B6: the agent's report after a person's `norn answer`, before the tick applies it", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    await boot(h);
  });
  afterAll(() => h.cleanup());

  test("`norn done` is accepted while the answer waits; no second answer; the tick applies both", async () => {
    await untilRunning(h);
    await parkOnPrompt(h);
    // the prompt was about the agent's own `… && norn done …`: the keys arrive and it runs at once
    expect((await h.norn("story", "answer", "gh-9", "1")).exit).toBe(0);
    const r = await runChecked(["done", "done", "--handoff", "reviewed"], { ...h.deps, cwd: wt(h) });
    expect(r.value).toMatchObject({ ok: true, kind: "done" });
    expect(r.exit).toBe(0);
    expect(receipts(h).slice(-2).map((x) => `${x.kind}:${x.by}`)).toEqual(["answer:human", "done:agent"]);
    h.runner.pane = { alive: true, state: "working", since: null };
    h.clock.advance(10_000);
    expect(acted(await h.tick())).toEqual(["gh-9 receipts.apply"]);
    expect(h.state(runs(h))).toMatchObject({ step: "$done", status: "done" });
  });
});

describe("B11: the tick and the agent resolve the same implicit ask", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    await boot(h);
  });
  afterAll(() => h.cleanup());

  test("the agent's answer takes the number first (S6): the tick's resolution is superseded, not a failure", async () => {
    await untilRunning(h);
    await parkOnPrompt(h);
    // the pane moved on, and while this tick observes it the agent reports
    h.runner.pane = { alive: true, state: "working", since: null };
    let report: Awaited<ReturnType<typeof runCli>> | null = null;
    h.runner.onPaneState = async () => {
      report = await runChecked(["done", "done", "--handoff", "fixed"], { ...h.deps, cwd: wt(h) });
    };
    h.clock.advance(10_000);
    const t = await h.tick();
    expect(report).toMatchObject({ exit: 0 });
    expect(acted(t)).toEqual(["gh-9 agent.ask.implicit.resolved"]);
    expect(t.failed).toBe(0);
    expect(receipts(h).slice(-2).map((x) => `${x.kind}:${x.by}`)).toEqual(["answer:agent", "done:agent"]);
    h.clock.advance(10_000);
    expect(acted(await h.tick())).toEqual(["gh-9 receipts.apply"]);
    expect(h.state(runs(h))).toMatchObject({ step: "$done", status: "done" });
  });
});

describe("R8.1: the launched agent runs this norn (acceptance 11)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    await boot(h);
  });
  afterAll(() => h.cleanup());

  test("the shim dir is first on PATH inside the command itself, and NORN_BIN names the shim", async () => {
    await untilRunning(h);
    const launch = h.runner.launches[0];
    const shim = join(h.home, "bin", "norn");
    // B2: the command is `<launcher> claude …`; the launcher (not the command line) carries PATH and NORN_BIN
    const launcher = launch?.argv[0] as string;
    expect(launcher).toStartWith(join(h.home, "launch") + "/");
    expect(launch?.argv[1]).toBe("claude");
    expect(readFileSync(launcher, "utf8")).toContain(`NORN_BIN=${proc.shellQuote(shim)}; export NORN_BIN`);
    expect(launch?.env).toMatchObject({ NORN_BIN: shim, PATH: expect.stringMatching(new RegExp(`^${join(h.home, "bin")}:`)) });
    // a login shell in the pane reset PATH: the launcher still puts this norn first
    const which = Bun.spawnSync([launcher, "sh", "-c", 'command -v norn; printf %s "$NORN_BIN"'], { env: { HOME: process.env.HOME ?? "/", PATH: "/usr/bin:/bin" } });
    expect(which.stdout.toString()).toBe(`${shim}\n${shim}`);
    // the shim execs this norn's entry point
    expect(statSync(shim).mode & 0o111).not.toBe(0);
    expect(readFileSync(shim, "utf8")).toContain("packages/cli/src/main.ts");
    const out = Bun.spawnSync([shim, "help"], { env: { ...process.env, NORN_HOME_DIR: h.home } });
    expect(out.exitCode).toBe(0);
  });
});

describe("B2: the launch command stays short whatever PATH is", () => {
  test("a 1.8 kB PATH gives a typed command far below the tty line limit (MAX_CANON 1 024)", () => {
    const home = mkdtempSync(join(tmpdir(), "norn-b2-"));
    try {
      const shim = join(home, "bin", "norn");
      const longPath = Array.from({ length: 60 }, (_, i) => `/Users/someone/.local/share/toolchain-${i}/bin`).join(":");
      expect(longPath.length).toBeGreaterThan(1_700);
      const argv = ["claude", "--model", "opus", AUTO_PROMPT];
      const out = withNornOnPath(argv, shim, longPath);
      const typed = proc.shellJoin(out.argv);
      expect(typed.length).toBeLessThan(proc.shellJoin(argv).length + 100);
      expect(out.argv.slice(1)).toEqual(argv);
      expect(out.env.PATH).toBe(`${join(home, "bin")}:${longPath}`);
      // the same PATH reuses the same launcher
      expect(withNornOnPath(["x"], shim, longPath).argv[0]).toBe(out.argv[0] as string);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("R9.1: launch prompt not received (acceptance 12)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    await boot(h);
  });
  afterAll(() => h.cleanup());

  test("SessionStart without a turn start: re-sent once after 60 s, then silent with the launch rule and an inbox line", async () => {
    const st = await untilRunning(h);
    const runId = st.run?.run_id as string;
    appendHookTrace(h.root, { story: "gh-9" }, { type: "hook", id: ulid(h.clock.now()), fact: { event: "session_start", at: h.clock.iso(), agent: "claude", native: "SessionStart", cwd: wt(h), story: "gh-9", run_id: runId } });
    h.clock.advance(30_000);
    expect(acted(await h.tick())).toEqual([]);
    h.clock.advance(31_000);
    expect(acted(await h.tick())).toEqual(["gh-9 agent.launch_prompt.resend"]);
    expect(h.runner.sent).toEqual([{ session: expect.objectContaining({ pane_id: "p-1" }), text: AUTO_PROMPT }]);
    expect(h.state(runs(h))).toMatchObject({ nudges_used: 0, run: { prompt_resent_at: h.clock.iso() } });
    h.clock.advance(30_000);
    expect(acted(await h.tick())).toEqual([]);
    h.clock.advance(31_000);
    expect(acted(await h.tick())).toEqual(["gh-9 agent.silent.launch_prompt.nudge"]);
    expect(receipts(h).at(-1)).toMatchObject({ kind: "classify", outcome: "silent", rule: "agent.silent.launch_prompt", detail: "launch prompt not received" });
    h.clock.advance(10_000);
    await h.tick();
    const inbox = (await h.norn("status")).value as Inbox;
    expect(inbox.groups.unblock).toEqual([expect.objectContaining({ title: "launch prompt not received by gh-9 implement — look at pane p-1", command: "fake attach p-1" })]);
  });
});
