/**
 * An agent run's life through the CLI alone, every norn call a subprocess of the binary from source:
 * held by manual mode or an attended step until a person starts it, the refusals and reports an agent
 * meets, a silent agent nudged and given up on, a run stopped and answered, a step rerun, and a launch
 * that cannot start. The agent is the test harness's script, its plan picked per step and visit.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MISSING_BIN } from "./fixtures/test-harness/plugin.ts";
import { agentNotes, awaitNote, flag, machineOf, type NornOut, noteOf, norn, plans, setUp, sh, unitOf, type World, world } from "./world.ts";

const KEY = "lt-1";
const SLOW = 180_000;
/** The longest a tick waits for the agent's hold (fixtures/test-harness/agent.ts, plan protocol). */
const HOLD_MS = 30_000;

/** One agent step that ends the story. */
const SOLO = ["name: solo", "start: build", "steps:", "  build:", "    agent: Build the thing.", "    outcomes: { done: $done }", ""].join("\n");
/** SOLO, held for a person whatever the config's mode. */
const HELD = SOLO.replace("name: solo", "name: held\nmode: manual");
/** SOLO, worked on beside a person. */
const ATTENDED = SOLO.replace("name: solo", "name: beside").replace("    agent: Build the thing.", "    agent: Build the thing with the person.\n    attended: true");
/** Build, then a review that can send it back with findings; both keep the unit's handoff. */
const REVIEWED = [
  "name: reviewed",
  "start: build",
  "steps:",
  "  build:",
  "    agent: Build the thing.",
  "    inputs: [handoff]",
  "    outcomes: { done: review }",
  "  review:",
  "    agent: Review the thing.",
  "    inputs: [handoff]",
  "    hand_back: { changes_requested: findings }",
  "    outcomes: { done: $done, changes_requested: { to: build, counter: review_loop } }",
  "counters:",
  "  review_loop: { max: 3 }",
  "",
].join("\n");

interface UnitSeen {
  id: string;
  step: string | null;
  attempt: number | null;
  ended?: string;
  ended_reason?: string;
  parked?: string;
  run: { id: string; activity: string | null } | null;
  waiting: { for: string; text: string; next?: string } | null;
}

interface Outcome {
  decision: { rule: string; unit: string | null };
  ok: boolean;
  error?: string;
}

/** Every rule a tick fired, a failed action marked `!`, and the failed outcomes themselves. */
class Ticks {
  readonly rules: string[] = [];
  /** failed actions, but for a commit that lost a race */
  readonly failed: { code: number; outcome: Outcome }[] = [];
  constructor(private readonly w: World) {}

  /** One tick, once the agent lets go of the hold; a failed action is kept, never thrown, so a test can look at it. */
  async once(): Promise<NornOut> {
    for (const until = performance.now() + HOLD_MS; existsSync(join(this.w.notes, "hold")) && performance.now() < until; ) await Bun.sleep(50);
    const t = await norn(this.w, ["tick", "--json"]);
    const outcomes = (t.body.outcomes ?? []) as Outcome[];
    this.rules.push(...outcomes.map((o) => `${o.decision.rule}${o.ok ? "" : "!"}`));
    for (const o of outcomes) if (!o.ok) this.failed.push({ code: t.code, outcome: o });
    if (t.code !== 0 && outcomes.every((o) => o.ok)) throw new Error(`tick exited ${t.code}: ${t.stdout}${t.stderr}`);
    return t;
  }

  /** Ticks until `done` holds of the unit, as watch would; patience out throws with every rule. */
  async until(done: (u: UnitSeen | null) => boolean, key = KEY, maxMs = 60_000): Promise<UnitSeen | null> {
    for (const until = performance.now() + maxMs; performance.now() < until; ) {
      await this.once();
      const u = (await unitOf(this.w, key)) as UnitSeen | null;
      if (done(u)) return u;
      await Bun.sleep(200);
    }
    throw new Error(`no convergence; rules: ${this.rules.join(", ")}; unit: ${JSON.stringify(await unitOf(this.w, key))}`);
  }
}

async function viewUnit(w: World, key = KEY): Promise<UnitSeen> {
  const v = await norn(w, ["story", "view", key, "--json"]);
  if (v.code !== 0) throw new Error(`story view: ${v.stdout}${v.stderr}`);
  return (v.body.units as UnitSeen[])[0] as UnitSeen;
}

const runsOf = (w: World): string[] => [...new Set(agentNotes(w).map((n) => n.run))];
const notesOf = (w: World, what: string): unknown[] => agentNotes(w).filter((n) => n.note === what).map((n) => n.value);
const alive = async (pid: number): Promise<boolean> => (await Bun.$`kill -0 ${pid}`.nothrow().quiet()).exitCode === 0;
const sessionLogs = (machine: string): string[] => (existsSync(join(machine, "runtime", "sessions")) ? readdirSync(join(machine, "runtime", "sessions")) : []);
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

describe("manual mode: a held step waits for a person to start it", () => {
  let w: World;
  let ticks: Ticks;
  let held: UnitSeen | null;
  let notesWhileHeld: number;
  let otherWhileHeld: UnitSeen | null;
  let stopNoRun: NornOut;
  let started: NornOut;
  let again: NornOut;
  let rulesAfterStart: string[] = [];
  let ended: UnitSeen | null;

  beforeAll(async () => {
    w = await world("work");
    // the config runs stories on their own; the held workflow keeps its steps for a person
    await setUp(w, { workflow: "solo", workflows: { solo: SOLO, held: HELD } });
    ticks = new Ticks(w);
    await norn(w, ["story", "create", "Held for a person", "--workflow", "held", "--json"]);
    await norn(w, ["story", "create", "Runs on its own", "--json"]);
    held = await ticks.until((u) => u?.parked !== undefined);
    otherWhileHeld = await ticks.until((u) => u?.ended === "done", "lt-2");
    notesWhileHeld = runsOf(w).length;
    stopNoRun = await norn(w, ["run", "stop", KEY, "--json"]);
    started = await norn(w, ["run", "start", KEY, "--json"]);
    again = await norn(w, ["run", "start", KEY, "--json"]);
    const from = ticks.rules.length;
    ended = await ticks.until((u) => u?.ended !== undefined);
    rulesAfterStart = ticks.rules.slice(from);
  }, SLOW);

  test("the held story parks at agent.ready.manual with no launch, while the auto story runs to done", () => {
    expect(held).toMatchObject({ step: "build", parked: "agent.ready.manual", run: null, waiting: { for: "person", next: `norn run start ${KEY}` } });
    expect(otherWhileHeld).toMatchObject({ ended: "done" });
    // the one agent that ran is lt-2's
    expect(notesWhileHeld).toBe(1);
  });

  test("run stop on a unit with no run is refused with no_run, exit 3", () => {
    expect(stopNoRun.code).toBe(3);
    expect(stopNoRun.body).toMatchObject({ code: "no_run", do_instead: `norn story view ${KEY}` });
  });

  test("run start records run.requested once however often it is sent, and the next tick launches the agent", () => {
    expect(started).toMatchObject({ code: 0, body: { unit: KEY, step: "build", attempt: 1, replayed: false } });
    expect(again).toMatchObject({ code: 0, body: { receipt_id: started.body.receipt_id, replayed: true } });
    expect(rulesAfterStart).toContain("agent.start");
    expect(rulesAfterStart.filter((r) => r === "agent.start")).toHaveLength(1);
    expect(ended).toMatchObject({ ended: "done" });
    expect(runsOf(w)).toHaveLength(2);
    expect(ticks.failed).toEqual([]);
  });
});

describe("an attended step: started by a person, who sits beside the agent", () => {
  let w: World;
  let ticks: Ticks;
  let held: UnitSeen | null;
  let started: NornOut;
  let again: NornOut;
  let ended: UnitSeen | null;

  beforeAll(async () => {
    w = await world("attended");
    // the test runner can host an attended run; the bundled headless runner cannot
    await setUp(w, { runner: "test", workflow: "beside", workflows: { beside: ATTENDED } });
    ticks = new Ticks(w);
    await norn(w, ["story", "create", "Pair on it", "--json"]);
    held = await ticks.until((u) => u?.parked !== undefined);
    started = await norn(w, ["run", "start", KEY, "--json"]);
    again = await norn(w, ["run", "start", KEY, "--json"]);
    ended = await ticks.until((u) => u?.ended !== undefined);
  }, SLOW);

  test("auto mode still holds it at agent.ready.attended, naming norn run start", () => {
    expect(held).toMatchObject({ parked: "agent.ready.attended", run: null, waiting: { next: `norn run start ${KEY}` } });
    expect(started).toMatchObject({ code: 0, body: { replayed: false } });
    expect(again).toMatchObject({ code: 0, body: { replayed: true } });
    expect(ticks.rules.filter((r) => r === "agent.start")).toHaveLength(1);
  });

  test("the brief says a person is in the session, and a stop before the report is let through", () => {
    const brief = (noteOf(w, "brief") as { text: string }).text;
    expect(brief).toContain("A person works with you in this session");
    expect(brief).toContain("never through `norn ask`");
    expect(noteOf(w, "stop.before-report")).toEqual({ kind: "allow" });
    expect(noteOf(w, "done")).toMatchObject({ code: 0, body: { outcome: "done" } });
    expect(ended).toMatchObject({ ended: "done" });
  });
});

describe("what an agent meets: refusals, one report, findings, the handoff, ask and stuck, rerun", () => {
  let w: World;
  let ticks: Ticks;
  let machine: string;
  let worktreeHandoffAfterDone: string;
  let reworkBrief: string;
  let atAsk: UnitSeen | null;
  let rerunAtAsk: NornOut;
  let afterAskRerun: UnitSeen | null;
  let stuck: UnitSeen | null;
  let statusMd: NornOut;
  let unknownStep: NornOut;
  let moved: NornOut;
  let movedAgain: NornOut;
  let restarted: UnitSeen | null;
  let worktreeStatus: string;

  beforeAll(async () => {
    w = await world("work");
    const { added } = await setUp(w, { workflow: "reviewed", workflows: { reviewed: REVIEWED } });
    machine = machineOf(added);
    plans(w, { "build#1": "protocol", "review#1": "findings", "review#2": "ask-then-stuck", "review#3": "ask-then-stuck" });
    ticks = new Ticks(w);
    await norn(w, ["story", "create", "Paint the button", "--json"]);
    await ticks.until((u) => u?.step === "review" && u.run !== null);
    worktreeHandoffAfterDone = readFileSync(noteOf(w, "handoff.path") as string, "utf8");
    await ticks.until((u) => u?.step === "review" && u.attempt === 2 && u.run !== null);
    reworkBrief = (notesOf(w, "brief") as { text: string }[]).find((b) => b.text.includes("· build #2"))?.text ?? "";
    atAsk = await ticks.until((u) => u?.step === "review" && u.parked !== undefined);
    // a rerun on an ask is a new visit: the question goes unanswered, the step starts again
    rerunAtAsk = await norn(w, ["run", "rerun", KEY, "--reason", "ask it again", "--json"]);
    afterAskRerun = await ticks.until((u) => u?.step === "review" && u.attempt === 3 && u.parked !== undefined);
    await norn(w, ["story", "answer", KEY, "Blue."]);
    stuck = await ticks.until((u) => u?.ended !== undefined);
    statusMd = await norn(w, ["status"]);
    unknownStep = await norn(w, ["run", "rerun", KEY, "--step", "nope", "--json"]);
    plans(w, { "build#1": "protocol", "review#1": "findings", "build#3": "work", "review#4": "work" });
    moved = await norn(w, ["run", "rerun", KEY, "--step", "build", "--reset", "review_loop", "--reason", "start over", "--json"]);
    movedAgain = await norn(w, ["run", "rerun", KEY, "--step", "build", "--reset", "review_loop", "--reason", "start over", "--json"]);
    restarted = await ticks.until((u) => u?.step === "build" && u.attempt === 3 && u.run !== null);
    await ticks.until((u) => u?.ended === "done");
    worktreeStatus = await sh(join(machine, "worktrees", KEY), "git", "status", "--porcelain");
  }, SLOW);

  test("a refusal is markdown (Refused … Do instead) or a --json CliError, exit 3 both ways", () => {
    const md = noteOf(w, "done.nope.md") as { code: number; stdout: string };
    expect(md.code).toBe(3);
    expect(md.stdout).toStartWith("**Refused (outcome):**");
    expect(md.stdout).toContain("Do instead: report one of `done`");
    expect(noteOf(w, "done.nope.json")).toEqual({ code: 3, body: { error: 'outcome "nope" is not one step build routes', do_instead: "report one of `done`", code: "outcome" } });
  });

  test("the agent verbs without the run's env give no_run_env, and under a made-up run stale_run", () => {
    const bare = noteOf(w, "no_run_env") as Record<string, { code: number; body: { code: string; do_instead: string } }>;
    for (const verb of ["brief", "done", "ask", "stuck"]) expect(bare[verb]).toMatchObject({ code: 3, body: { code: "no_run_env", do_instead: expect.any(String) } });
    const stale = noteOf(w, "stale_run") as Record<string, { code: number; body: { code: string } }>;
    expect(stale.brief).toMatchObject({ code: 3, body: { code: "stale_run" } });
    expect(stale.done).toMatchObject({ code: 3, body: { code: "stale_run" } });
  });

  test("the brief names the step, its done outcomes and History", () => {
    const first = (noteOf(w, "brief") as { text: string }).text;
    expect(first).toContain("# norn brief — lt-1 · build #1");
    expect(first).toContain("Build the thing.");
    expect(first).toContain("`norn done done`");
    const review = (notesOf(w, "brief") as { text: string }[]).find((b) => b.text.includes("· review #1"))?.text ?? "";
    expect(review).toContain("## History");
    expect(review).toContain("`build #1` reported `done done`");
  });

  test("a done over an 8 KB handoff is refused and the run stays live; the next done goes through, and a second report is refused", () => {
    expect(noteOf(w, "done.big-handoff")).toMatchObject({ code: 3, body: { code: "handoff_too_large", error: expect.stringContaining("at most 8 KB") } });
    expect(noteOf(w, "done")).toMatchObject({ code: 0, body: { verb: "done", outcome: "done", replayed: false } });
    expect(noteOf(w, "second-report")).toMatchObject({ code: 3, body: { code: "reported" } });
  });

  test("the handoff stays byte for byte as the agent wrote it, reaches the next step, and leaves the worktree clean", () => {
    expect(sha256(worktreeHandoffAfterDone)).toBe(noteOf(w, "handoff.sha") as string);
    const read = notesOf(w, "handoff.read") as (string | null)[];
    // the review step's agent finds what the build step left
    expect(read[1]).toContain("the handoff marker 7f3a");
    expect(noteOf(w, "git.status")).toBe("");
  });

  test("changes_requested with findings puts a Rework section, with the findings, in the next brief", () => {
    expect(reworkBrief).toContain("## Rework");
    expect(reworkBrief).toContain("`review` reported `done changes_requested`");
    expect(reworkBrief).toContain("The button is the wrong colour");
  });

  test("a rerun on an ask is a new visit with attempt + 1", () => {
    // the person is sent to answer the question, never to a rerun that would throw it away
    expect(atAsk).toMatchObject({
      attempt: 2,
      parked: "agent.asked",
      waiting: { for: "answer", text: "Which colour should the button be?", next: `norn story answer ${KEY} "<answer>"` },
    });
    expect(rerunAtAsk).toMatchObject({ code: 0, body: { from: "review", step: "review", attempt: 2, replayed: false } });
    expect(afterAskRerun).toMatchObject({ attempt: 3, parked: "agent.asked", waiting: { text: "Which colour should the button be?" } });
    expect(afterAskRerun?.run?.id).not.toBe(atAsk?.run?.id);
  });

  test("ask, answer, then stuck ends the unit stuck, and status names norn run rerun", () => {
    expect(stuck).toMatchObject({ ended: "stuck", ended_reason: "The answer leaves nothing to build.", waiting: { next: `norn run rerun ${KEY}` } });
    expect(statusMd.stdout).toContain(`→ norn run rerun ${KEY}`);
  });

  test("rerun --step names the steps when refused; --step with --reset and --reason records once and starts the step again", () => {
    expect(unknownStep).toMatchObject({ code: 3, body: { code: "unknown_step", do_instead: "name one of build, review", details: { steps: ["build", "review"] } } });
    expect(moved).toMatchObject({ code: 0, body: { from: "review", step: "build", reset: ["review_loop"], stops_run: null, replayed: false } });
    expect(movedAgain).toMatchObject({ code: 0, body: { receipt_id: moved.body.receipt_id, replayed: true } });
    expect(restarted).toMatchObject({ step: "build", attempt: 3 });
    expect(ticks.rules).toContain("unit.move");
    expect(worktreeStatus).toBe("");
    expect(ticks.failed).toEqual([]);
  });
});

describe("a silent agent: nudged in its own session, then given up on", () => {
  let w: World;
  let ticks: Ticks;
  let ended: UnitSeen | null;
  let viewed: UnitSeen;

  beforeAll(async () => {
    w = await world("hang");
    await setUp(w, { runner: "test", workflow: "solo", workflows: { solo: SOLO }, config: [["kernel.silent_after", "2s"], ["kernel.max_nudges", "2"]] });
    ticks = new Ticks(w);
    await norn(w, ["story", "create", "Go quiet", "--json"]);
    await ticks.until((u) => u?.run !== null);
    await awaitNote(w, "pid");
    // the first nudge needs a stop the runner cannot make: it fails where a person sees it
    flag(w, "stop-fails", true);
    await ticks.until(() => ticks.failed.length > 0);
    flag(w, "stop-fails", false);
    ended = await ticks.until((u) => u?.ended !== undefined, KEY, 90_000);
    viewed = await viewUnit(w);
  }, SLOW);

  test("a nudge that cannot be delivered is a failed action naming the story, and the tick exits 1", () => {
    expect(ticks.failed[0]).toMatchObject({ code: 1, outcome: { decision: { rule: "agent.silent.nudge", unit: KEY }, ok: false, error: expect.stringContaining("stop-fails") } });
  });

  test("the next nudge resumes the same session, and once the nudges are spent the unit ends stuck", () => {
    expect(ticks.rules.indexOf("agent.silent.nudge")).toBeGreaterThan(-1);
    expect(ticks.rules.indexOf("agent.silent.exhausted")).toBeGreaterThan(ticks.rules.indexOf("agent.silent.nudge"));
    // one run all the way: the nudge resumed its session with the nudge as the prompt
    expect(runsOf(w)).toHaveLength(1);
    expect(noteOf(w, "answered")).toMatchObject({ session: `s-${runsOf(w)[0]}` });
    expect(ended).toMatchObject({ ended: "stuck", ended_reason: expect.stringContaining("silent: nudges 2/2 used at build") });
    expect(viewed.waiting).toMatchObject({ text: expect.stringContaining("silent"), next: `norn run rerun ${KEY}` });
  });

  test("no agent process outlives the unit", async () => {
    for (const pid of notesOf(w, "pid") as number[]) expect(await alive(pid)).toBe(false);
  });
});

describe("a silent agent once its story is put in manual mode: a person decides, never a nudge", () => {
  let w: World;
  let ticks: Ticks;
  let parked: UnitSeen | null;
  let stopped: NornOut;

  beforeAll(async () => {
    w = await world("hang");
    await setUp(w, { runner: "test", workflow: "solo", workflows: { solo: SOLO }, config: [["kernel.silent_after", "2s"]] });
    ticks = new Ticks(w);
    await norn(w, ["story", "create", "Go quiet with a person", "--json"]);
    await ticks.until((u) => u?.run !== null);
    await awaitNote(w, "pid");
    // a run nobody started by hand is the person's to judge once the mode is manual
    const set = await norn(w, ["config", "set", "kernel.mode", "manual", "--json"]);
    if (set.code !== 0) throw new Error(`config set: ${set.stdout}${set.stderr}`);
    parked = await ticks.until((u) => u?.parked !== undefined || u?.ended !== undefined);
    stopped = await norn(w, ["run", "stop", KEY, "--json"]);
  }, SLOW);

  test("the quiet run parks at agent.silent.manual, saying it went quiet and naming norn run rerun", () => {
    expect(parked).toMatchObject({ parked: "agent.silent.manual", waiting: { for: "person", text: "its run went quiet without a report", next: `norn run rerun ${KEY}` } });
    expect(ticks.rules.filter((r) => r.startsWith("agent.silent.nudge"))).toEqual([]);
    expect(ticks.failed).toEqual([]);
  });

  test("the person's stop ends the quiet process", async () => {
    expect(stopped).toMatchObject({ code: 0, body: { stopped: true } });
    for (const pid of notesOf(w, "pid") as number[]) expect(await alive(pid)).toBe(false);
  });
});

describe("a run stopped by a person, answered, rerun while it runs, then finished", () => {
  let w: World;
  let ticks: Ticks;
  let machine: string;
  let pid: number;
  let logsWhileRunning: string[];
  let stopFailed: NornOut;
  let parkedAfterFail: UnitSeen;
  let stopped: NornOut;
  let pidAliveAfterStop: boolean;
  let leftInWorktree: string;
  let rulesAfterStop: string[];
  let parked: UnitSeen;
  let answered: NornOut;
  let resumed: UnitSeen | null;
  let rerun: NornOut;
  let rerunStarted: UnitSeen | null;
  let ended: UnitSeen | null;

  beforeAll(async () => {
    w = await world("hang");
    const { added } = await setUp(w, { runner: "test", workflow: "solo", workflows: { solo: SOLO }, config: [["kernel.silent_after", "2s"]] });
    machine = machineOf(added);
    plans(w, { "build#2": "work" });
    ticks = new Ticks(w);
    await norn(w, ["story", "create", "Stop it", "--json"]);
    const first = await ticks.until((u) => u?.run !== null);
    pid = (await awaitNote(w, "pid")) as number;
    logsWhileRunning = sessionLogs(machine);
    flag(w, "stop-fails", true);
    stopFailed = await norn(w, ["run", "stop", KEY, "--json"]);
    parkedAfterFail = await viewUnit(w);
    flag(w, "stop-fails", false);
    stopped = await norn(w, ["run", "stop", KEY, "--json"]);
    pidAliveAfterStop = await alive(pid);
    leftInWorktree = await sh(join(machine, "worktrees", KEY), "git", "status", "--porcelain");
    // past the silent window: a stopped run is neither relaunched, nudged nor retried
    await Bun.sleep(2_500);
    const from = ticks.rules.length;
    for (let i = 0; i < 3; i++) await ticks.once();
    rulesAfterStop = ticks.rules.slice(from);
    parked = await viewUnit(w);
    answered = await norn(w, ["story", "answer", KEY, "Carry on."]);
    resumed = await ticks.until((u) => u?.parked === undefined && u?.run?.id === first?.run?.id);
    await awaitNote(w, "answered");
    rerun = await norn(w, ["run", "rerun", KEY, "--json"]);
    rerunStarted = await ticks.until((u) => u?.attempt === 2 && u.run !== null);
    ended = await ticks.until((u) => u?.ended !== undefined);
    // the tick after the end finishes the story
    await ticks.until(() => ticks.rules.includes("story.finish"));
  }, SLOW);

  test("the session log lives at <machine>/runtime/sessions/<run>.log while the run lives", () => {
    expect(logsWhileRunning).toEqual([`${runsOf(w)[0]}.log`]);
  });

  test("a stop that fails exits 1 with do_instead `norn run stop lt-1 again`, and the park stays", () => {
    expect(stopFailed).toMatchObject({ code: 1, body: { do_instead: `norn run stop ${KEY} again`, error: expect.stringContaining("stop-fails") } });
    expect(parkedAfterFail.run).not.toBeNull();
  });

  test("run stop parks the unit and ends the process; the work stays, and nothing relaunches, nudges or retries it", () => {
    expect(stopped).toMatchObject({ code: 0, body: { unit: KEY, stopped: true } });
    expect(pidAliveAfterStop).toBe(false);
    expect(leftInWorktree).toContain("?? wip.txt");
    expect(rulesAfterStop.filter((r) => /agent\.(start|silent|died|turn_ended)/.test(r))).toEqual([]);
    expect(parked).toMatchObject({ parked: expect.stringContaining("stopped by"), waiting: { for: "answer", next: `norn story answer ${KEY} "<answer>"` } });
  });

  test("story answer resumes the stopped session", () => {
    expect(answered.code).toBe(0);
    expect(resumed?.run?.id).toBe(runsOf(w)[0]);
    expect(noteOf(w, "answered")).toMatchObject({ prompt: expect.stringContaining("Carry on.") });
  });

  test("rerun of a running unit stops the live session, then starts the step again as a new run", async () => {
    expect(rerun).toMatchObject({ code: 0, body: { step: "build", attempt: 1, stops_run: runsOf(w)[0], replayed: false } });
    expect(rerunStarted?.run?.id).not.toBe(runsOf(w)[0]);
    for (const p of notesOf(w, "pid") as number[]) expect(await alive(p)).toBe(false);
    expect(ended).toMatchObject({ ended: "done" });
  });

  test("the session logs are removed when the story finishes", () => {
    expect(sessionLogs(machine)).toEqual([]);
    expect(ticks.failed).toEqual([]);
  });
});

describe("an agent binary that is not there", () => {
  let w: World;
  let ticks: Ticks;
  let afterLaunch: UnitSeen;
  let seen: UnitSeen[] = [];
  let ended: UnitSeen | null;
  let tookMs: number;

  beforeAll(async () => {
    w = await world("work");
    // the config's silent window, far past the test's patience: the failed launch must not wait it out
    await setUp(w, { workflow: "solo", workflows: { solo: SOLO }, config: [["kernel.silent_after", "30m"]] });
    flag(w, "missing-bin", true);
    ticks = new Ticks(w);
    await norn(w, ["story", "create", "Cannot start", "--json"]);
    await ticks.until(() => ticks.failed.length > 0);
    afterLaunch = await viewUnit(w);
    const from = performance.now();
    ended = await ticks.until((u) => {
      if (u) seen.push(u);
      return u?.ended !== undefined;
    });
    tookMs = performance.now() - from;
  }, SLOW);

  test("the launch is a failed action naming the path, the tick exits 1, and no agent ever runs", () => {
    expect(ticks.failed[0]).toMatchObject({ code: 1, outcome: { decision: { rule: "agent.start", unit: KEY }, ok: false, error: expect.stringContaining(MISSING_BIN) } });
    expect(afterLaunch.run).toBeNull();
    expect(agentNotes(w)).toEqual([]);
  });

  test("the failed launch never shows as running: its session reads ended at once, the retry fails the same way, and the unit ends stuck naming the path", () => {
    for (const u of seen) expect([u.run?.id, u.run?.activity ?? "ended"]).toEqual([u.run?.id, "ended"]);
    expect(ticks.rules).toContain("agent.died.retry!");
    expect(ended?.ended).toBe("stuck");
    expect(ended?.ended_reason).toStartWith("died: the agent could not be launched");
    expect(ended?.ended_reason).toContain(MISSING_BIN);
    expect(ended?.ended_reason).toContain("retries 1/1 used");
    expect(tookMs).toBeLessThan(60_000);
  });
});

describe("an agent that exits at once, as one without a login does", () => {
  let w: World;
  let ticks: Ticks;
  let ended: UnitSeen | null;
  let statusMd: NornOut;

  beforeAll(async () => {
    w = await world("logged-out");
    await setUp(w, { workflow: "solo", workflows: { solo: SOLO }, config: [["kernel.silent_after", "30m"]] });
    ticks = new Ticks(w);
    await norn(w, ["story", "create", "Cannot log in", "--json"]);
    ended = await ticks.until((u) => u?.ended !== undefined);
    statusMd = await norn(w, ["status"]);
  }, SLOW);

  test("its retry exits the same way, and the unit ends stuck with the head of its log in the reason status shows", () => {
    expect(ticks.rules).toContain("agent.died.retry");
    expect(ended?.ended).toBe("stuck");
    expect(ended?.ended_reason).toStartWith("died: the agent exited before it acted: Not logged in · Please run /login");
    expect(ended?.ended_reason).toContain("retries 1/1 used");
    expect(statusMd.stdout).toContain("Not logged in · Please run /login");
  });
});
