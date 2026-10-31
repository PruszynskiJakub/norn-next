/**
 * Agent protocol verbs through the CLI (B3–B6, MO3, MO4, §9.3, A2–A4): a manual-mode story
 * (tick marks the step ready → `norn brief` in the worktree starts the run → `norn done` →
 * tick advances), rework findings in the next brief, exactly-once reports, refusals with
 * do_instead, and `norn hook` block/allow on turn end (unattended vs attended steps).
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BriefJson } from "@norn/core";
import { type HookTrace, type TickTrace, ulid } from "@norn/schema";
import { appendHookTrace, machineDir, readTickInputs, readTrace, readTraceFile, remoteCachePath, repoConfigPath, setTraceReadObserver, type TraceFileRead, workflowsDir } from "@norn/store";
import { type CliResult } from "../../src/index.ts";
import { parseFindings } from "../../src/commands/done.ts";
import { createHarness, type Harness, issue } from "../../../../test/support/harness.ts";
import { runChecked } from "../../../../test/support/harness.ts";

// whole flows over real git, several ticks each: 5 s is too tight on a loaded machine (full suite)
setDefaultTimeout(30_000);

const DUO = `name: duo
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    inputs: [spec, diff, handoff, last_findings]
    outcomes: { done: { to: review, means: "every criterion has a passing test" } }
  review:
    type: agent
    skill: norn-review
    outcomes:
      approve: { to: sign-off, means: "no blocking findings" }
      changes_requested: { to: implement, counter: review_loop, means: "blocking findings in the receipt" }
  sign-off:
    type: gate
    outcomes: { approve: $done, reject: { to: implement, counter: review_loop } }
counters: { review_loop: { max: 3 } }
`;

const PAIR = `name: pair
start: refine
steps:
  refine:
    type: agent
    skill: norn-refine
    attended: true
    outcomes: { done: { to: $done, means: "the person agrees the spec is ready" } }
`;

const CONFIG = `agents:
  claude: { adapter: claude }
remote: { provider: gh, label: norn }
default_workflow: duo
default_mode: manual
notifiers: []
`;

let h: Harness;
const spec = ".agents/specs/gh-9-manual-thing";
const wt = () => `${h.root}-worktrees/gh-9-manual-thing`;
const runs = () => join(wt(), spec, "runs/_story");
const pairWt = () => `${h.root}-worktrees/gh-10-pair-on-it`;
const pairRuns = () => join(pairWt(), ".agents/specs/gh-10-pair-on-it", "runs/_story");

function env() {
  const e: Record<string, string | undefined> = { ...h.deps.env, NORN_AGENT_PID: String(process.pid) };
  for (const k of ["NORN_AGENT", "NORN_RUN", "NORN_STORY", "NORN_SLICE", "NORN_AGENT_SESSION_ID"]) delete e[k];
  return e;
}
/** run `norn …` inside a worktree, as an agent would */
const inWt = (cwd: string, ...argv: string[]): Promise<CliResult> => runChecked(argv, { ...h.deps, cwd, env: env() });
const hook = (cwd: string, event: string, payload: Record<string, unknown>, ...flags: string[]) =>
  runChecked(["hook", event, ...flags], { ...h.deps, cwd, env: env(), stdin: JSON.stringify({ session_id: "sess-1", transcript_path: "/tmp/t.jsonl", cwd, ...payload }) });
const stop = (cwd: string) => hook(cwd, "stop", { hook_event_name: "Stop", stop_hook_active: false });
/** B5 (D3): the lines of a unit's hook file (`_story` for the story unit) */
const hookFileLines = (story: string, unit = "_story") => {
  const file = join(machineDir(h.root), "hooks", story, `${unit}.jsonl`);
  return existsSync(file) ? h.read(file).split("\n").filter(Boolean) : [];
};
/** every hook line of the day files, as written */
const dayHookLines = () =>
  readdirSync(machineDir(h.root))
    .filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n))
    .sort()
    .flatMap((n) => h.read(join(machineDir(h.root), n)).split("\n"))
    .filter((l) => l.startsWith('{"type":"hook"'));
/** the trace files `run` opens through the trace-read observer, each once, by kind (B4, B8–B10) */
async function opened(run: () => Promise<unknown>): Promise<Record<TraceFileRead["kind"], string[]>> {
  const seen: TraceFileRead[] = [];
  const prev = setTraceReadObserver((r) => seen.push(r));
  try {
    await run();
  } finally {
    setTraceReadObserver(prev);
  }
  const of = (kind: TraceFileRead["kind"]) => [...new Set(seen.filter((r) => r.kind === kind).map((r) => r.file))];
  return { day: of("day"), hook: of("hook") };
}
const openedDays = async (run: () => Promise<unknown>) => (await opened(run)).day;
const receipts = (dir: string) => (existsSync(join(dir, "receipts")) ? readdirSync(join(dir, "receipts")).sort() : []);
const readReceipt = (dir: string, name: string) => JSON.parse(h.read(join(dir, "receipts", name)));

async function tickUntil(pred: () => boolean, max = 10) {
  for (let i = 0; i < max && !pred(); i++) {
    h.clock.advance(10_000);
    await h.tick();
  }
  expect(pred()).toBe(true);
}

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.write(repoConfigPath(h.root), CONFIG);
  h.write(join(workflowsDir(h.root), "duo.yaml"), DUO);
  h.write(join(workflowsDir(h.root), "pair.yaml"), PAIR);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(9, "Manual thing"), issue(10, "Pair on it", ["norn", "norn:wf:pair"])];
});
afterAll(() => h.cleanup());

describe("manual mode: tick → brief → done → tick (MO3, B3, §9.3)", () => {
  let runId = "";

  test("the tick marks the agent step ready and never launches (manual)", async () => {
    await tickUntil(() => h.state(runs())?.step === "implement");
    h.clock.advance(10_000);
    const r = await h.tick();
    expect(r.decisions.find((d) => d.unit === "gh-9")?.rule).toBe("agent.ready.manual");
    expect(h.state(runs())).toMatchObject({ step: "implement", status: "ready", run: null, mode: "manual" });
    expect(h.runner.launches).toEqual([]);
  });

  test("outside a unit worktree the verbs refuse with do_instead", async () => {
    for (const argv of [["brief"], ["done", "done", "--handoff", "x"], ["ask", "q?"], ["stuck", "r"]]) {
      const r = await h.norn(...argv);
      expect(r.exit).toBe(3);
      expect(r.value).toMatchObject({ code: "not_in_unit", do_instead: expect.stringContaining("worktree") });
    }
  });

  test("done before brief: no run yet → do_instead norn brief", async () => {
    const r = await inWt(wt(), "done", "done", "--handoff", "x");
    expect(r.exit).toBe(3);
    expect(r.value).toMatchObject({ code: "no_run", do_instead: expect.stringContaining("norn brief") });
    // the agent reads the refusal as markdown; the exit code and `--json` carry it for code
    expect(r.stdout).toStartWith("**Refused (no_run):** ");
    expect(r.stdout).toContain("\nDo instead: ");
    const json = await inWt(wt(), "done", "done", "--handoff", "x", "--json");
    expect(json.exit).toBe(3);
    expect(JSON.parse(json.stdout)).toMatchObject({ code: "no_run", do_instead: expect.stringContaining("norn brief") });
  });

  test("hook in a ready step without a run never blocks; the fact lands in the trace (A2)", async () => {
    const r = await hook(wt(), "post-tool-use", { hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "norn brief" } });
    expect(r).toMatchObject({ exit: 0, value: {} });
    expect((await stop(wt())).value).toEqual({});
    const hooks = readTrace(h.root, { types: ["hook"] }).events as HookTrace[];
    expect(hooks.map((e) => e.fact.event)).toEqual(["tool_use", "turn_end"]);
    expect(hooks[0]?.fact).toMatchObject({ agent: "claude", native: "PostToolUse", story: "gh-9", agent_session_id: "sess-1", command: "norn brief" });
    expect(hooks.some((e) => e.blocked)).toBe(false);
    // B5, B7: the same lines land in gh-9's hook file, run id or not (no run yet), and `norn run list` shows them
    expect(hooks.every((e) => !e.fact.run_id)).toBe(true);
    expect(hookFileLines("gh-9")).toEqual(dayHookLines());
    expect(hookFileLines("gh-9")).toHaveLength(2);
    const trace = await h.norn("run", "list", "gh-9", "--events", "--all", "--json");
    expect(trace.stdout).toContain(hooks[0]?.id as string);
  });

  test("first brief starts the run: started receipt with session + PID; briefing stored (B4)", async () => {
    const before = receipts(runs());
    const r = await inWt(wt(), "brief");
    expect(r.exit).toBe(0);
    // the brief is for an agent to read: markdown on stdout, not a JSON string
    expect(r.stdout.startsWith("# norn brief — gh-9 · implement #1\n")).toBe(true);
    const briefing = readTrace(h.root, { unit: "gh-9", types: ["briefing"] }).events.at(-1) as { run_id: string; briefing: string };
    const v = { run_id: briefing.run_id, briefing: briefing.briefing, markdown: r.stdout };
    runId = v.run_id;
    expect(v.markdown).not.toContain("norn:header");
    expect(v.markdown).not.toContain("norn:heartbeat");
    expect(v.markdown).toContain("Use the `norn-implement` skill.");
    expect(v.markdown).toContain(`- Run: ${runId}`);
    expect(v.markdown).toContain('`norn done done --handoff "…"` — every criterion has a passing test');
    expect(v.markdown).toContain("Diff: `git diff origin/main...HEAD`"); // F33: the fetched base, not local main
    expect(readTraceFile(h.root, v.briefing)).toBe(v.markdown);
    // O4: the trace links the run to its briefing, and `norn run list` shows it
    const linked = readTrace(h.root, { unit: "gh-9", types: ["briefing"] }).events;
    expect(linked.at(-1)).toMatchObject({ type: "briefing", unit: "gh-9", run_id: runId, step: "implement", attempt: 1, briefing: v.briefing });
    const timeline = (await h.norn("run", "list", "gh-9", "--events")).value as { steps: Array<{ step: string; paths: { briefings: string[] }; events: Array<{ source: string; ref: string; summary: string }> }> };
    const row = timeline.steps.find((r) => r.step === "implement");
    expect(row?.paths.briefings).toEqual([join(machineDir(h.root), v.briefing)]);
    expect(row?.events.find((e) => e.source === "briefing")).toMatchObject({ ref: join(machineDir(h.root), v.briefing), summary: expect.stringContaining(runId) });

    const added = receipts(runs()).filter((f) => !before.includes(f));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatch(/-started\.json$/);
    const started = readReceipt(runs(), added[0] as string);
    expect(started).toMatchObject({ kind: "started", run_id: runId, step: "implement", attempt: 1, by: "agent", how: "manual", agent: "claude", agent_session_id: "sess-1", worktree: wt() });
    expect(started.process.pid).toBe(process.pid);
  });

  test("brief again (no tick yet) reuses the run; --json gives the data form", async () => {
    const r = await inWt(wt(), "brief", "--json");
    const v = r.value as { run_id: string; started: boolean; brief: BriefJson };
    expect(v).toMatchObject({ run_id: runId, started: false });
    expect(v.brief.where).toMatchObject({ story: "gh-9", step: "implement", attempt: 1, mode: "manual", attended: false, run_id: runId });
    expect(v.brief.finish.map((f) => f.command)).toEqual(['norn done done --handoff "…"', 'norn ask "<question>"', 'norn stuck "<reason>"']);
    expect(receipts(runs()).filter((f) => f.endsWith("-started.json"))).toHaveLength(1);
  });

  test("Stop in an unattended step whose run has not reported → blocked with the report instruction (A4)", async () => {
    const r = await stop(wt());
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ decision: "block", reason: expect.stringContaining("norn done <done>") });
    const last = (readTrace(h.root, { types: ["hook"] }).events as HookTrace[]).at(-1);
    expect(last).toMatchObject({ blocked: true, fact: { event: "turn_end", run_id: runId } });
  });

  test("B4: `norn run list` prints the same events with lines it does not show added, broken or not; every reader opens day files through the observer", async () => {
    const before = await h.norn("run", "list", "gh-9", "--events", "--all", "--json");
    expect(before.exit).toBe(0);
    const days = () => readdirSync(machineDir(h.root)).filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).sort().map((n) => join(machineDir(h.root), n));
    const last = days().at(-1) as string;
    appendFileSync(last, '{"type":"tick.start",broken\n');
    appendFileSync(last, `${JSON.stringify({ type: "local_file", id: "01M5MA3PG0DB4G1MJNV0HKQYSA", at: new Date(h.clock.now()).toISOString(), file: remoteCachePath(h.root), schema: "local-remote", reason: "unreadable", errors: [] })}\n`);
    const after = await h.norn("run", "list", "gh-9", "--events", "--all", "--json");
    expect(after.stdout).toBe(before.stdout);
    // a reader of every type still reports the broken line
    expect(readTrace(h.root).errors.map((e) => e.file)).toContainEqual(expect.stringMatching(/\.jsonl:\d+$/));

    expect(await openedDays(() => h.norn("run", "list", "gh-9"))).toEqual(days());
    // B8, B9: the blocked-hook count and the tick's hook facts come from the unit's hook file, no day file
    expect(await openedDays(() => stop(wt()))).toEqual([]);
    expect(await openedDays(() => h.tick())).toEqual([]);
    expect(await openedDays(() => h.norn("status", "--history"))).toEqual(days());
  });

  test("the tick applies the started receipt: running, how manual (MO3)", async () => {
    h.clock.advance(10_000);
    await h.tick();
    expect(h.state(runs())).toMatchObject({ status: "running", run: { run_id: runId, how: "manual", agent_session_id: "sess-1" } });
  });

  test("done with an undeclared outcome is refused, listing the valid ones", async () => {
    const r = await inWt(wt(), "done", "approve", "--handoff", "x");
    expect(r.exit).toBe(3);
    expect(r.value).toMatchObject({ code: "invalid_outcome", error: expect.stringContaining("valid: done"), do_instead: 'norn done done --handoff "…"', details: { valid: ["done"] } });
    expect((await inWt(wt(), "done", "done")).exit).toBe(2); // --handoff is required
    expect((await inWt(wt(), "done", "stuck", "--handoff", "x")).value).toMatchObject({ code: "use_verb", do_instead: 'norn stuck "<reason>"' });
  });

  test("done writes the receipt, appends handoff progress and says end your turn; a second report is refused", async () => {
    const r = await inWt(wt(), "done", "done", "--handoff", "form renders; tests added");
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ ok: true, unit: "gh-9", kind: "done", outcome: "done", run_id: runId, next: "end your turn" });
    expect(r.stdout).toStartWith("Reported `done done` (gh-9, step implement #1).\nReceipt: `");
    expect(r.stdout).toEndWith("**End your turn now.** Do not report again; norn routes the work from here.\n");
    const file = receipts(runs()).at(-1) as string;
    expect(readReceipt(runs(), file)).toMatchObject({ kind: "done", outcome: "done", handoff: "form renders; tests added", run_id: runId, by: "agent", who: "claude" });
    expect(h.read(join(runs(), "handoff.md"))).toMatch(/## Progress\n\n- implement#1 done: form renders; tests added\n\n## Resume/);

    for (const argv of [["done", "done", "--handoff", "again"], ["ask", "q?"], ["stuck", "r"], ["brief"]]) {
      const again = await inWt(wt(), ...argv);
      expect(again.exit).toBe(3);
      expect(again.value).toMatchObject({ code: "already_reported", do_instead: "end your turn" });
    }
    expect((await stop(wt())).value).toEqual({}); // reported → turn end allowed
  });

  test("the tick advances to review; the next brief starts a fresh run", async () => {
    h.clock.advance(10_000);
    await h.tick();
    expect(h.state(runs())).toMatchObject({ step: "review", status: "ready", attempt: 1, last_outcome: { step: "implement", outcome: "done", source: "reported" } });
    const r = await inWt(wt(), "brief", "--json");
    const v = r.value as { run_id: string; started: boolean; markdown: string };
    expect(v.started).toBe(true);
    expect(v.run_id).not.toBe(runId);
    expect(v.markdown).toContain("- implement#1 done: form renders; tests added");
    runId = v.run_id;
  });

  test("done --findings/--evidence: findings copied into the receipt, evidence into runs/<unit>/evidence/<run_id>/", async () => {
    const tmp = join(h.dir, "review-out");
    mkdirSync(join(tmp, "ev"), { recursive: true });
    writeFileSync(join(tmp, "ev", "AC1.md"), "observed\n");
    writeFileSync(
      join(tmp, "findings.json"),
      JSON.stringify({ summary: "one blocker", findings: [{ id: "F1", axis: "spec", severity: "blocking", criterion: "AC2", file: "src/a.ts", line: 4, title: "Expired invites accepted", detail: "seen in test", suggestion: "check expiry" }] }),
    );
    const r = await inWt(wt(), "done", "changes_requested", "--handoff", "one blocker", "--findings", join(tmp, "findings.json"), "--evidence", join(tmp, "ev"));
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ outcome: "changes_requested", findings: 1, evidence: `evidence/${runId}` });
    const done = readReceipt(runs(), receipts(runs()).at(-1) as string);
    expect(done.findings).toEqual([{ id: "F1", severity: "blocking", criterion: "AC2", file: "src/a.ts", line: 4, title: "Expired invites accepted", detail: "seen in test\nAxis: spec\nSuggestion: check expiry" }]);
    expect(existsSync(join(runs(), "evidence", runId, "AC1.md"))).toBe(true);
  });

  test("back in implement, the brief shows the findings as Rework (B3, B6)", async () => {
    h.clock.advance(10_000);
    await h.tick();
    expect(h.state(runs())).toMatchObject({ step: "implement", attempt: 2, counters: { review_loop: 1 } });
    const v = (await inWt(wt(), "brief", "--json")).value as { brief: BriefJson };
    expect(v.brief.rework).toMatchObject({ from: "review.changes_requested", findings: { step: "review", outcome: "changes_requested", items: [{ title: "Expired invites accepted" }] } });
  });

  test("ask records the question and options; the parked unit refuses brief with norn answer", async () => {
    const r = await inWt(wt(), "ask", "Which expiry?", "--option", "24h", "--option", "7d");
    expect(r.value).toMatchObject({ ok: true, kind: "ask", question: "Which expiry?", options: ["24h", "7d"], answer_with: 'norn story answer gh-9 "…"', next: "end your turn" });
    expect(r.stdout).toContain("Options: 24h · 7d\nThey answer with `norn story answer gh-9 \"…\"`");
    expect(r.stdout).toContain("**End your turn now.**");
    expect((await inWt(wt(), "stuck", "nope")).value).toMatchObject({ code: "already_reported" });
    h.clock.advance(10_000);
    await h.tick();
    expect(h.state(runs())).toMatchObject({ status: "parked", park: { kind: "ask", reason: "Which expiry?" } });
    expect((await stop(wt())).value).toEqual({}); // parked: never block
    h.report(runs(), "answer", { answer: "24h" }, "human");
    h.clock.advance(10_000);
    await h.tick();
    expect(h.state(runs())).toMatchObject({ status: "running", step: "implement", attempt: 2 });
    // the answer resumes the same run: one more report is allowed (B2)
    const v = (await inWt(wt(), "brief", "--json")).value as { started: boolean; brief: BriefJson };
    expect(v.started).toBe(false);
    expect(v.brief.context.answers).toEqual([{ question: "Which expiry?", answer: "24h" }]);
    expect((await inWt(wt(), "stuck", "cannot reach the API")).value).toMatchObject({ ok: true, kind: "stuck", unblock_with: "norn run rerun gh-9" });
    h.clock.advance(10_000);
    await h.tick();
    expect(h.state(runs())).toMatchObject({ status: "stuck", park: { kind: "stuck", reason: "cannot reach the API" } });
    expect((await inWt(wt(), "brief")).value).toMatchObject({ code: "unit_stuck", do_instead: expect.stringContaining("norn run rerun gh-9") });
  });

  test("a gate step refuses brief with norn approve", async () => {
    h.report(runs(), "unstick", { to: "sign-off" }, "human");
    h.clock.advance(10_000);
    await h.tick();
    expect(h.state(runs())).toMatchObject({ step: "sign-off", status: "parked" });
    const r = await inWt(wt(), "brief");
    expect(r.exit).toBe(3);
    expect(r.value).toMatchObject({ code: "gate_step", do_instead: expect.stringContaining("norn story approve gh-9") });
  });
});

describe("attended steps never block (MO4)", () => {
  test("brief starts the attended run; Stop is allowed without a report; done completes it", async () => {
    await tickUntil(() => h.state(pairRuns())?.step === "refine");
    expect(h.state(pairRuns())).toMatchObject({ status: "parked", park: { kind: "attended" } });
    // B10: hook facts of two units in the trace; the brief takes the session from its own unit's only
    const tool = (cwd: string, session_id: string) => hook(cwd, "pre-tool-use", { hook_event_name: "PreToolUse", session_id, tool_name: "Bash", tool_input: { command: "ls" } });
    await tool(pairWt(), "sess-pair");
    h.clock.advance(1_000);
    await tool(wt(), "sess-other");
    let b: CliResult | undefined;
    expect(await openedDays(async () => (b = await inWt(pairWt(), "brief", "--json")))).toEqual([]); // B10: no day file
    expect(b?.value).toMatchObject({ unit: "gh-10", step: "refine", started: true });
    const started = receipts(pairRuns()).filter((f) => f.endsWith("-started.json"));
    expect(readReceipt(pairRuns(), started.at(-1) as string)).toMatchObject({ kind: "started", agent_session_id: "sess-pair", worktree: pairWt() });
    expect((b?.value as { markdown: string }).markdown).toContain("Attended step: no deadline or nudges (MO4)");
    expect((await stop(pairWt())).value).toEqual({});
    h.clock.advance(10_000);
    await h.tick();
    expect(h.state(pairRuns())).toMatchObject({ status: "running", step: "refine" });
    expect((await stop(pairWt())).value).toEqual({});
    expect((await inWt(pairWt(), "done", "done", "--handoff", "spec agreed")).exit).toBe(0);
    h.clock.advance(10_000);
    await h.tick();
    expect(h.state(pairRuns())).toMatchObject({ step: "$done", status: "done" });
  });
});

describe("norn hook robustness (A3)", () => {
  test("outside a unit worktree: no-op, nothing traced", async () => {
    const before = readTrace(h.root, { types: ["hook"] }).events.length;
    const hookFiles = () => (existsSync(join(machineDir(h.root), "hooks")) ? readdirSync(join(machineDir(h.root), "hooks"), { recursive: true }).map(String).sort() : []);
    const files = hookFiles();
    const r = await hook(h.root, "stop", { hook_event_name: "Stop" });
    expect(r).toMatchObject({ exit: 0, value: {} });
    expect(readTrace(h.root, { types: ["hook"] }).events.length).toBe(before);
    expect(hookFiles()).toEqual(files); // B6: no hook file either
  });

  test("garbage stdin, unknown events and unknown agents never fail", async () => {
    expect(await runChecked(["hook", "stop"], { ...h.deps, cwd: wt(), env: env(), stdin: "not json{" })).toMatchObject({ exit: 0, value: {} });
    expect((await hook(wt(), "frobnicate", {})).value).toEqual({});
    expect((await hook(wt(), "stop", { hook_event_name: "Stop" }, "--agent", "nope")).value).toEqual({});
  });

  test("--agent picks the adapter even when another one also knows the event (A2)", async () => {
    const before = readTrace(h.root, { types: ["hook"] }).events.length;
    const facts = () => readTrace(h.root, { types: ["hook"] }).events.slice(before) as Array<{ fact: { agent: string; event: string } }>;
    await hook(wt(), "session-start", { session_id: "s-codex" }, "--agent", "codex");
    await hook(wt(), "session-start", { session_id: "s-claude" });
    expect(facts().map((e) => [e.fact.agent, e.fact.event])).toEqual([
      ["codex", "session_start"],
      ["claude", "session_start"],
    ]);
  });

  test("installed hook commands use event names the hook accepts (A1/A2)", async () => {
    const settings = JSON.parse(h.read(join(h.root, ".claude/settings.json"))) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> };
    const before = readTrace(h.root, { types: ["hook"] }).events.length;
    for (const [native, groups] of Object.entries(settings.hooks)) {
      const command = groups[0]?.hooks[0]?.command as string;
      const m = /^norn hook (\S+) --agent (\S+) # norn-owned$/.exec(command);
      expect(m).not.toBeNull();
      expect(m?.[2]).toBe("claude");
      const payload: Record<string, unknown> = native === "Notification" ? { message: "Claude needs your permission to use Bash", notification_type: "permission_prompt" } : {};
      // no hook_event_name: the argument alone must identify the event
      expect((await hook(wt(), m?.[1] as string, payload, "--agent", m?.[2] as string)).exit).toBe(0);
    }
    expect(readTrace(h.root, { types: ["hook"] }).events.length - before).toBe(Object.keys(settings.hooks).length);
  });

  test("blocks are bounded per run (P5)", async () => {
    // a fresh unattended run in gh-9: a person moves the unit back to implement
    h.report(runs(), "unstick", { to: "implement" }, "human");
    h.clock.advance(10_000);
    await h.tick();
    const b = (await inWt(wt(), "brief", "--json")).value as { run_id: string };
    const hookEvents = () => (readTrace(h.root, { types: ["hook"] }).events as HookTrace[]).filter((e) => e.fact.run_id === b.run_id);
    // an idle_prompt Notification is a turn end too (§10 silent), but Claude cannot refuse it:
    // never traced blocked, never counted toward MAX_STOP_BLOCKS (A4)
    for (let i = 0; i < 2; i++) {
      const idle = await hook(wt(), "notification", { hook_event_name: "Notification", notification_type: "idle_prompt", message: "Claude is waiting for your input" });
      expect(idle).toMatchObject({ exit: 0, value: {} });
    }
    expect(hookEvents().map((e) => [e.fact.event, e.blocked ?? false])).toEqual([
      ["turn_end", false],
      ["turn_end", false],
    ]);
    // another blocking adapter's own turn-end event (gemini AfterAgent) is refused and counted
    const gem = await hook(wt(), "after-agent", { hook_event_name: "AfterAgent", prompt_response: "all done" }, "--agent", "gemini");
    expect(gem.value).toMatchObject({ decision: "deny" });
    expect(hookEvents().at(-1)).toMatchObject({ blocked: true, fact: { agent: "gemini", native: "AfterAgent", event: "turn_end" } });
    const results: string[] = [];
    // B9: the count comes from gh-9's hook file only; no day file is opened
    expect(await openedDays(async () => {
      for (let i = 0; i < 4; i++) results.push(((await stop(wt())).value as { decision?: string }).decision ?? "allow");
    })).toEqual([]);
    expect(results).toEqual(["block", "block", "allow", "allow"]);
    expect(b.run_id).toMatch(/^[0-9A-Z]{26}$/);
  });

  test("a Claude permission prompt parks the unit and shows the pending command in norn inbox (§10, O1)", async () => {
    h.clock.advance(10_000);
    await h.tick();
    expect(h.state(runs())).toMatchObject({ status: "running", step: "implement" });
    h.clock.advance(1_000);
    await hook(wt(), "pre-tool-use", { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "rm -rf build" } });
    await hook(wt(), "notification", { hook_event_name: "Notification", notification_type: "permission_prompt", message: "Claude needs your permission to use Bash" });
    h.clock.advance(10_000);
    await h.tick();
    expect(h.state(runs())).toMatchObject({ status: "parked", park: { kind: "ask", reason: "Claude needs your permission to use Bash", command: "Bash(rm -rf build)" } });
    expect(readReceipt(runs(), receipts(runs()).at(-1) as string)).toMatchObject({ kind: "ask", implicit: true, command: "Bash(rm -rf build)" });
    const inbox = (await h.norn("status")).value as { groups: Record<string, Array<{ story: string; title: string; detail?: string; command: string }>> };
    expect(inbox.groups.answer).toContainEqual(
      expect.objectContaining({ story: "gh-9", title: "Claude needs your permission to use Bash", detail: "pending command: Bash(rm -rf build)", command: 'norn story answer gh-9 "…"' }),
    );
    const text = (await h.norn("status")).stdout;
    expect(text).toContain("pending command: Bash(rm -rf build)");
  });

  test("B8 (D4): a tick reads the hook files of units with a live run and of units written within limits.stalled, never a day file", async () => {
    // gh-9 is parked on its implicit ask (a live run); gh-10 is done, with no live run
    const run9 = h.state(runs())?.run?.run_id as string;
    expect(h.state(pairRuns())).toMatchObject({ status: "done", run: null });
    h.clock.advance(1_000);
    // hook lines for other units: gh-10's lands in its hook file and the day file, gh-404's (no such unit) too
    appendHookTrace(h.root, { story: "gh-10" }, { type: "hook", id: ulid(h.clock.now()), fact: { event: "tool_use", at: h.clock.iso(), agent: "claude", native: "PostToolUse", cwd: pairWt(), story: "gh-10" } });
    appendHookTrace(h.root, { story: "gh-404" }, { type: "hook", id: ulid(h.clock.now()), fact: { event: "tool_use", at: h.clock.iso(), agent: "claude", native: "PostToolUse", cwd: "/elsewhere", story: "gh-404" } });
    const file = (story: string) => join(machineDir(h.root), "hooks", story, "_story.jsonl");
    /** one tick: the hook files and day files it opens, and the hook facts of gh-9's run in its facts */
    const tick = async () => {
      const { day: days, hook } = await opened(() => h.tick());
      const hooks = hook.sort();
      const last = readTrace(h.root, { types: ["tick"] }).events.at(-1) as TickTrace;
      const read = readTickInputs(h.root, last);
      if (!read.ok) throw new Error(JSON.stringify(read));
      const facts = read.inputs.facts;
      const gh9 = facts.stories.find((s) => s.key === "gh-9")?.units[0];
      return { hooks, days, run9: gh9?.run?.hooks.map((f) => f.run_id) ?? [] };
    };
    const own = (hookFileLines("gh-9").map((l) => JSON.parse(l) as HookTrace)).filter((e) => e.fact.run_id === run9);
    expect(own.length).toBeGreaterThan(0);
    // within the stalled window (15m): gh-10's file is read beside gh-9's, gh-404 (no unit) never
    h.clock.advance(14 * 60_000);
    expect(await tick()).toEqual({ hooks: [file("gh-10"), file("gh-9")], days: [], run9: own.map(() => run9) });
    // past it: gh-9's file only
    h.clock.advance(2 * 60_000);
    expect(await tick()).toEqual({ hooks: [file("gh-9")], days: [], run9: own.map(() => run9) });
    expect(h.state(runs())).toMatchObject({ status: "parked", run: { run_id: run9 } });
  });
});

describe("parseFindings", () => {
  test("accepts an array or {findings}; refuses missing severity", () => {
    expect(parseFindings(JSON.stringify([{ severity: "minor", title: "t" }]), "f")).toEqual([{ severity: "minor", title: "t" }]);
    expect(() => parseFindings(JSON.stringify({ findings: [{ title: "t" }] }), "f")).toThrow("severity");
    expect(() => parseFindings("{", "f")).toThrow("not valid JSON");
  });
});

describe("hook backfill on upgrade (B11, B12, D5)", () => {
  let g: Harness;
  const gWt = () => `${g.root}-worktrees/gh-9-manual-thing`;
  const gRuns = () => join(gWt(), spec, "runs/_story");
  const backfillFile = () => join(machineDir(g.root), "hooks", "backfill.json");
  const gHookFile = () => join(machineDir(g.root), "hooks", "gh-9", "_story.jsonl");
  const gHookIds = () => (existsSync(gHookFile()) ? g.read(gHookFile()).split("\n").filter(Boolean).map((l) => (JSON.parse(l) as HookTrace).id) : []);
  const gDays = () => readdirSync(machineDir(g.root)).filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n));
  let runId = "";
  let runStart = 0;
  /** 400 hook lines of gh-9's run, written only to the day files, the way the previous version wrote them */
  const old: HookTrace[] = [];

  beforeAll(async () => {
    g = await createHarness();
    expect((await g.norn("init")).exit).toBe(0);
    g.write(repoConfigPath(g.root), CONFIG);
    g.write(join(workflowsDir(g.root), "duo.yaml"), DUO);
    g.git(["add", "-A"]);
    g.git(["commit", "-q", "-m", "norn init"]);
    g.git(["push", "-q", "origin", "main"]);
    g.remote.issues = [issue(9, "Manual thing")];
  });
  afterAll(() => g.cleanup());

  test("AC3: a run started after the backfill's since never has a day file scanned for it", async () => {
    for (let i = 0; i < 10 && g.state(gRuns())?.status !== "ready"; i++) {
      g.clock.advance(10_000);
      await g.tick();
    }
    expect(g.state(gRuns())).toMatchObject({ step: "implement", status: "ready" });
    const since = (JSON.parse(g.read(backfillFile())) as { since: string; done: string[] }).since;
    g.clock.advance(10_000);
    const brief = await runChecked(["brief", "--json"], { ...g.deps, cwd: gWt(), env: { ...g.deps.env, NORN_AGENT_PID: String(process.pid) } });
    expect(brief.exit).toBe(0);
    runId = (brief.value as { run_id: string }).run_id;
    g.clock.advance(10_000);
    expect(await openedDays(() => g.tick())).toEqual([]);
    const st = g.state(gRuns());
    expect(st).toMatchObject({ status: "running", run: { run_id: runId } });
    runStart = Date.parse(st?.run?.started_at as string);
    expect(st?.run?.started_at as string > since).toBe(true);
    expect(await openedDays(() => g.tick())).toEqual([]);
  });

  test("AC1: the first tick of the new version copies a live run's hook lines from yesterday's and today's day files once", async () => {
    // the upgrade: no backfill.json, no hook file yet, the run's hook lines only in the day files
    rmSync(backfillFile());
    rmSync(gHookFile(), { force: true });
    const midnight = Date.parse(`${new Date(runStart).toISOString().slice(0, 10)}T00:00:00.000Z`) + 86_400_000;
    for (let i = 0; i < 400; i++) {
      // 200 lines yesterday (after the run began), 200 today
      const at = i < 200 ? runStart + (i + 1) * 60_000 : midnight + (i - 200) * 1_000;
      const ev: HookTrace = { type: "hook", id: ulid(at), fact: { event: "tool_use", at: new Date(at).toISOString(), agent: "claude", native: "PostToolUse", cwd: gWt(), story: "gh-9", run_id: runId, tool: "Bash" } };
      old.push(ev);
      appendFileSync(join(machineDir(g.root), `${ev.fact.at.slice(0, 10)}.jsonl`), `${JSON.stringify(ev)}\n`);
    }
    // another unit's hook line in the same day file is never copied into gh-9's
    const other: HookTrace = { type: "hook", id: ulid(midnight), fact: { event: "tool_use", at: new Date(midnight).toISOString(), agent: "claude", native: "PostToolUse", cwd: "/elsewhere", story: "gh-404" } };
    appendFileSync(join(machineDir(g.root), `${other.fact.at.slice(0, 10)}.jsonl`), `${JSON.stringify(other)}\n`);
    g.clock.t = midnight + 400_000;
    await g.tick();
    expect(gHookIds()).toEqual(old.map((e) => e.id));
    expect(JSON.parse(g.read(backfillFile()))).toEqual({ since: new Date(midnight + 400_000).toISOString(), done: ["gh-9"] });
    // the second tick copies nothing and scans no day file
    g.clock.advance(10_000);
    const before = g.read(gHookFile());
    expect(await openedDays(() => g.tick())).toEqual([]);
    expect(g.read(gHookFile())).toBe(before);
  });

  test("AC2: a backfill left unfinished, with a hook fired meanwhile, completes on the next tick with each event id once", async () => {
    // a crashed backfill: part of the copy written, gh-9 not yet in done
    const backfill = JSON.parse(g.read(backfillFile())) as { since: string; done: string[] };
    g.write(backfillFile(), JSON.stringify({ since: backfill.since, done: [] }));
    g.write(gHookFile(), `${old.slice(0, 150).map((e) => JSON.stringify(e)).join("\n")}\n`);
    // a hook fires into gh-9's hook file (and today's day file) meanwhile
    g.clock.advance(10_000);
    const fired = await runChecked(["hook", "post-tool-use"], { ...g.deps, cwd: gWt(), env: { ...g.deps.env, NORN_AGENT_PID: String(process.pid) }, stdin: JSON.stringify({ session_id: "sess-1", cwd: gWt(), hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "ls" } }) });
    expect(fired.exit).toBe(0);
    const ids = gHookIds();
    expect(ids).toHaveLength(151);
    const newId = ids.at(-1) as string;
    g.clock.advance(10_000);
    await g.tick();
    const after = gHookIds();
    expect(new Set(after).size).toBe(after.length);
    expect(after.sort()).toEqual([...old.map((e) => e.id), newId].sort());
    expect((JSON.parse(g.read(backfillFile())) as { done: string[] }).done).toEqual(["gh-9"]);
    expect(gDays().length).toBeGreaterThan(1);
  });
});
