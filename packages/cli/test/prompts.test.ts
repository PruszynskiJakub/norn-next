/**
 * Prompts and launches end to end (SPEC-auto-mode-recovery §4 acceptance 9, 11, 12):
 *   - R6.1: an implicit ask (a prompt in the agent's pane) does not refuse the agent's report — the
 *     report is accepted behind an `answer` receipt `by: "agent"`
 *   - R6.2: `norn answer` types the option number + enter into the prompt, then writes the receipt
 *     (`delivered`), which the tick does not type again
 *   - R6.3: a delivery that fails writes no receipt, keeps the unit parked, and the Answer item
 *     names how to reach the pane
 *   - R8.1: the launch command puts the norn shim first on PATH inside the command, NORN_BIN set
 *   - R9.1: SessionStart without a turn start → one re-send, then `silent` "launch prompt not received"
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { herdr } from "@norn/adapters";
import { AUTO_PROMPT, type Inbox } from "@norn/core";
import { type Receipt, type UnitState, ulid } from "@norn/schema";
import { appendTrace } from "@norn/store";
import type { TickReport } from "../src/index.ts";
import { runCli } from "../src/index.ts";
import { createHarness, type Harness, issue } from "./harness.ts";

const SOLO = `name: solo
start: implement
steps:
  implement:
    type: agent
    skill: implement
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
const runs = (h: Harness) => join(wt(h), SPEC, "runs/_story");
const acted = (r: TickReport) => r.decisions.filter((d) => d.kind !== "noop" && d.rule !== "claim.renew").map((d) => `${d.unit} ${d.rule}${d.ok ? "" : ` FAILED ${d.error}`}`);
const receipts = (h: Harness): Receipt[] =>
  readdirSync(join(runs(h), "receipts"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(runs(h), "receipts", f), "utf8")) as Receipt);

async function boot(h: Harness): Promise<void> {
  expect((await h.norn("init")).exit).toBe(0);
  h.write(join(h.root, ".agents/norn/config.yaml"), CONFIG);
  h.write(join(h.root, ".agents/norn/workflows/solo.yaml"), SOLO);
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
    const inbox = (await h.norn("inbox")).value as Inbox;
    expect(inbox.groups.answer).toEqual([
      expect.objectContaining({
        title: "Contains brace with quote character (expansion obfuscation) Do you want to proceed?",
        detail: "pending command: cat >> test/web.test.ts <<'EOF' · options: 1. Yes · 2. Yes, and switch to auto mode · auto mode handles these prompts for you · 3. No — answer with the number",
        command: 'norn answer gh-9 "…"',
      }),
    ]);
    expect(inbox.groups.answer[0]).not.toHaveProperty("full");
    const details = (await h.norn("inbox", "--details")).value as Inbox;
    expect(details.groups.answer[0]?.full).toBe(SCREEN);
    const text = (await h.norn("inbox", "--text")).value as string;
    expect(text).not.toContain("│ EOF");
    expect((await h.norn("inbox", "--text", "--details")).value).toContain("      | ╌╌╌");
  });

  test("`norn done` is accepted: an answer by the agent closes the ask, then the report applies", async () => {
    const r = await runCli(["done", "done", "--handoff", "fixed"], { ...h.deps, cwd: wt(h) });
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
    const r = await h.norn("answer", "gh-9", "1");
    expect(r.exit).toBe(1);
    expect(r.value).toMatchObject({ code: "answer_not_delivered", error: "answer to gh-9 not delivered: pane p-1 is gone", do_instead: "answer it in the pane: fake attach p-1" });
    expect(receipts(h)).toHaveLength(before);
    h.clock.advance(10_000);
    await h.tick();
    expect(h.state(runs(h))).toMatchObject({ status: "parked", park: { kind: "ask" } });
    const inbox = (await h.norn("inbox")).value as Inbox;
    expect(inbox.groups.answer[0]).toMatchObject({ command: "fake attach p-1", detail: expect.stringContaining("not delivered: answer to gh-9 not delivered: pane p-1 is gone") });
    expect(inbox.groups.unblock).toEqual([]);
  });

  test("not an option of the prompt → usage error, nothing typed", async () => {
    h.runner.keysError = null;
    const r = await h.norn("answer", "gh-9", "maybe");
    expect(r.exit).toBe(2);
    expect(r.value).toMatchObject({ code: "not_an_option", error: expect.stringContaining("1. Yes · 2. Yes, and switch") });
    expect(h.runner.keyed).toEqual([]);
  });

  test("a choice: option number + enter typed, then the receipt (delivered); the tick types nothing again", async () => {
    const r = await h.norn("answer", "gh-9", "3");
    expect(r.exit).toBe(0);
    expect(h.runner.keyed).toEqual([{ session: expect.objectContaining({ pane_id: "p-1" }), keys: [{ text: "3" }, { key: "enter" }] }]);
    expect(receipts(h).at(-1)).toMatchObject({ kind: "answer", by: "human", answer: "3", delivered: true });
    h.runner.pane = { alive: true, state: "working", since: null };
    h.clock.advance(10_000);
    const t = await h.tick();
    expect(acted(t)).toEqual(["gh-9 receipts.apply"]);
    expect(h.state(runs(h))).toMatchObject({ status: "running", park: null });
    expect(h.runner.sent).toEqual([]);
    expect(((await h.norn("inbox")).value as Inbox).groups.answer).toEqual([]);
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
    expect(launch?.argv.slice(0, 3)).toEqual(["env", expect.stringMatching(new RegExp(`^PATH=${join(h.home, "bin")}:`)), `NORN_BIN=${shim}`]);
    expect(launch?.argv[3]).toBe("claude");
    expect(launch?.env).toMatchObject({ NORN_BIN: shim, PATH: expect.stringMatching(new RegExp(`^${join(h.home, "bin")}:`)) });
    // the shim execs this norn's entry point
    expect(statSync(shim).mode & 0o111).not.toBe(0);
    expect(readFileSync(shim, "utf8")).toContain("packages/cli/src/main.ts");
    const out = Bun.spawnSync([shim, "help"], { env: { ...process.env, NORN_HOME_DIR: h.home } });
    expect(out.exitCode).toBe(0);
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
    appendTrace(h.root, { type: "hook", id: ulid(h.clock.now()), fact: { event: "session_start", at: h.clock.iso(), agent: "claude", native: "SessionStart", cwd: wt(h), story: "gh-9", run_id: runId } });
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
    const inbox = (await h.norn("inbox")).value as Inbox;
    expect(inbox.groups.unblock).toEqual([expect.objectContaining({ title: "launch prompt not received by gh-9 implement — look at pane p-1", command: "fake attach p-1" })]);
  });
});
