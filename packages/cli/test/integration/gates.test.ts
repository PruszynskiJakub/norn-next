/**
 * Gates, criteria, counters and the review loop through the CLI alone, every norn call a subprocess
 * of the binary from source: a person's approve and reject and what each refuses, a QA report's
 * verdicts and notes as the person at the gate reads them, counters bumped, shown, run out and reset,
 * checks routed by their exit codes, and a decision racing the tick that brings the unit to its gate.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentNotes, machineOf, type NornOut, norn, plans, reports, setUp, sh, unitOf, type World, world } from "./world.ts";

const KEY = "lt-1";
const SLOW = 240_000;

interface UnitSeen {
  id: string;
  step: string | null;
  kind: string | null;
  attempt: number | null;
  ended?: string;
  ended_reason?: string;
  parked?: string;
  run: { id: string; executor: string } | null;
  waiting: { for: string; text: string; next?: string } | null;
  counters?: Record<string, { value: number; max: number }>;
}

interface Verdict {
  id: string;
  verdict: string;
  how?: string;
  reason?: string;
  evidence?: string;
}

interface StorySeen {
  units: UnitSeen[];
  criteria: { unit: string; step: string | null; verdicts: Verdict[] }[];
  notes: { unit: string; text: string; criterion?: string }[];
  problems: string[];
}

interface Outcome {
  decision: { rule: string };
  ok: boolean;
  error?: string;
}

/** Every rule a tick fired, a failed action marked `!`. */
class Ticks {
  readonly rules: string[] = [];
  constructor(private readonly w: World) {}

  async once(): Promise<NornOut> {
    const t = await norn(this.w, ["tick", "--json"]);
    const outcomes = (t.body.outcomes ?? []) as Outcome[];
    this.rules.push(...outcomes.map((o) => `${o.decision.rule}${o.ok ? "" : "!"}`));
    if (t.code !== 0 && !outcomes.every((o) => o.ok)) throw new Error(`tick exited ${t.code}: ${t.stdout}${t.stderr}`);
    return t;
  }

  async until(done: (u: UnitSeen | null) => boolean, maxMs = 90_000): Promise<UnitSeen> {
    for (const until = performance.now() + maxMs; performance.now() < until; ) {
      await this.once();
      const u = (await unitOf(this.w, KEY)) as UnitSeen | null;
      if (u && done(u)) return u;
      await Bun.sleep(200);
    }
    throw new Error(`no convergence; rules: ${this.rules.join(", ")}; unit: ${JSON.stringify(await unitOf(this.w, KEY))}`);
  }
}

const atGate = (step: string, attempt?: number) => (u: UnitSeen | null) => u?.step === step && u.waiting?.for === "gate" && (attempt === undefined || u.attempt === attempt);

async function view(w: World): Promise<StorySeen> {
  const v = await norn(w, ["story", "view", KEY, "--json"]);
  if (v.code !== 0) throw new Error(`story view: ${v.stdout}${v.stderr}`);
  return v.body as unknown as StorySeen;
}

const unitIn = (s: StorySeen): UnitSeen => s.units[0] as UnitSeen;

/** The briefs the agent read, in launch order, with the visit their title names. */
const briefs = (w: World): string[] => agentNotes(w).filter((n) => n.note === "brief").map((n) => (n.value as { text: string }).text);

/** Every receipt file under the machine dir whose data is of `kind`. */
function receiptsOf(machine: string, kind: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".json") && dir.includes("receipts")) {
        const r = JSON.parse(readFileSync(p, "utf8")) as { data?: { kind?: string } };
        if (r.data?.kind === kind) out.push(r as Record<string, unknown>);
      }
    }
  };
  walk(machine);
  return out;
}

const refusal = (r: NornOut) => ({ code: r.code, error: r.body.error, code_name: r.body.code, do_instead: r.body.do_instead });

/** Build, the repo's detected test command as the check, then the person's gate, which sends it back on reject. */
const GATED = [
  "name: gated",
  "start: build",
  "steps:",
  "  build:",
  "    agent: Build the thing.",
  "    outcomes: { done: test }",
  "  test:",
  '    check: "{checks.test}"',
  "    timeout: 1m",
  "    outcomes: { pass: ready, fail: build }",
  "  ready:",
  "    gate: Approve the thing.",
  "    outcomes: { approve: $done, reject: build }",
  "",
].join("\n");

describe("a person's decision at a gate", () => {
  let w: World;
  let ticks: Ticks;
  let machine: string;
  let noReason: NornOut;
  let asAgent: NornOut;
  let rejected: NornOut;
  let afterReject: StorySeen;
  let secondAtBuild: NornOut;
  let atReadyAgain: StorySeen;
  let statusMd: string;
  let approved: NornOut;
  let ended: UnitSeen;

  beforeAll(async () => {
    w = await world("work");
    // a Makefile test target init detects, writing where the check ran
    writeFileSync(join(w.root, "Makefile"), `test:\n\tpwd > ${join(w.notes, "ran.txt")}\n`);
    await sh(w.root, "git", "add", "Makefile");
    await sh(w.root, "git", "commit", "-q", "-m", "a test target");
    await sh(w.root, "git", "push", "-q", "origin", "main");
    const { added } = await setUp(w, { workflow: "gated", workflows: { gated: GATED } });
    machine = machineOf(added);
    ticks = new Ticks(w);
    await norn(w, ["story", "create", "Gated", "--json"]);
    await ticks.until(atGate("ready", 1));
    noReason = await norn(w, ["story", "reject", KEY, "--json"]);
    asAgent = await norn(w, ["story", "approve", KEY, "--json"], { NORN_RUN_ID: "01ARZ3NDEKTSV4RRFFQ69G5FAV" });
    rejected = await norn(w, ["story", "reject", KEY, "--reason", "Make the button blue.", "--json"]);
    await ticks.until((u) => u?.step === "build");
    afterReject = await view(w);
    secondAtBuild = await norn(w, ["story", "approve", KEY, "--json"]);
    await ticks.until(atGate("ready", 2));
    atReadyAgain = await view(w);
    statusMd = (await norn(w, ["status"])).stdout;
    // from the unit's worktree, as a person in its folder decides, with no run in the env
    approved = await norn(w, ["story", "approve", KEY, "--reason", "Blue it is.", "--json"], {}, join(machine, "worktrees", KEY));
    ended = await ticks.until((u) => u?.ended !== undefined);
  }, SLOW);

  test("init's detected test command is what the check ran, in the unit's worktree", () => {
    expect(readFileSync(join(w.notes, "ran.txt"), "utf8").trim()).toEndWith(join("worktrees", KEY));
  });

  test("a reject without --reason is refused, exit 3, naming the reason to give", () => {
    expect(refusal(noReason)).toMatchObject({ code: 3, code_name: "reason" });
    expect(String(noReason.body.do_instead)).toContain(`norn story reject ${KEY} --reason`);
  });

  test("an approve under a run's env is refused as agent_gate", () => {
    expect(refusal(asAgent)).toMatchObject({ code: 3, code_name: "agent_gate" });
  });

  test("a reject with a reason sends the unit back to build, its counter bumped", () => {
    expect(rejected.code).toBe(0);
    expect(unitIn(afterReject)).toMatchObject({ step: "build", attempt: 2 });
    expect(unitIn(afterReject).counters?.["ready.reject"]).toEqual({ value: 1, max: 2 });
  });

  test("the next build's brief carries a Rework section with the reason", () => {
    const second = briefs(w)[1] as string;
    expect(second).toContain("## Rework");
    expect(second).toContain("Make the button blue.");
  });

  test("a second decision once the unit left the gate is refused, exit 3", () => {
    expect(refusal(secondAtBuild)).toMatchObject({ code: 3, code_name: "not_at_gate" });
  });

  test("status markdown names the attempt and the counter spent", () => {
    expect(unitIn(atReadyAgain)).toMatchObject({ step: "ready", attempt: 2 });
    expect(statusMd).toContain("attempt 2");
    expect(statusMd).toContain("ready.reject 1/2");
  });

  test("an approve from the worktree with no run is accepted, its reason kept on the record and shown back", () => {
    expect(approved.code).toBe(0);
    expect(approved.body).toMatchObject({ step: "ready", attempt: 2, outcome: "approve", reason: "Blue it is." });
    const decided = receiptsOf(machine, "gate.decided").map((r) => r.data as Record<string, unknown>);
    expect(decided).toContainEqual(expect.objectContaining({ outcome: "approve", reason: "Blue it is." }));
    expect(ended).toMatchObject({ ended: "done" });
  });
});

/** QA reports a verdict per criterion; what it could not check goes to a person, who may send it back. */
const QA = [
  "name: qa",
  "start: qa",
  "steps:",
  "  qa:",
  "    agent: Check the story against its criteria.",
  "    criteria: required",
  "    outcomes: { pass: ready, unverified: human-qa }",
  "    verdict: { pass: pass, unverified: unverified }",
  "  human-qa:",
  "    gate: Check the criteria QA could not settle.",
  "    outcomes: { approve: ready, reject: qa }",
  "  ready:",
  "    gate: Approve the thing.",
  "    outcomes: { approve: $done, reject: qa }",
  "",
].join("\n");

const AC1 = { id: "AC1", verdict: "pass", evidence: "the settings page loads in the test run" };
const AC2 = { id: "AC2", verdict: "unverified", reason: "no browser in this session", how: "open /settings and press Save" };

describe("QA's verdicts and notes at the person's gate", () => {
  let w: World;
  let ticks: Ticks;
  let atHumanQa: StorySeen;
  let statusMd: string;
  let backAtHumanQa: StorySeen;
  let atReady: StorySeen;

  beforeAll(async () => {
    w = await world("report");
    reports(w, {
      "qa#1": { criteria: [AC1, { ...AC2, note: "the first note: Save sits below the fold" }], tries: [["done", "pass"], ["done", "unverified"]] },
      "qa#2": { criteria: [AC1, { ...AC2, note: "the second note: still no browser" }], tries: [["done", "unverified"]] },
    });
    await setUp(w, { workflow: "qa", workflows: { qa: QA } });
    ticks = new Ticks(w);
    await norn(w, ["story", "create", "Settings save", "--json"]);
    await ticks.until(atGate("human-qa", 1));
    atHumanQa = await view(w);
    statusMd = (await norn(w, ["status"])).stdout;
    await norn(w, ["story", "reject", KEY, "--reason", "Save does nothing on Safari.", "--json"]);
    await ticks.until(atGate("human-qa", 2));
    backAtHumanQa = await view(w);
    await norn(w, ["story", "approve", KEY, "--json"]);
    await ticks.until(atGate("ready"));
    atReady = await view(w);
  }, SLOW);

  const tries = (n: number) => agentNotes(w).filter((x) => x.note === `try.${n}`).map((x) => x.value as { code: number; body: Record<string, unknown> });

  test("done pass with an unverified criterion is refused, naming the matching outcome; done unverified goes through", () => {
    const [refused, accepted] = [tries(1)[0], tries(2)[0]];
    expect(refused).toMatchObject({ code: 3, body: { code: "outcome_contradicts_verdicts" } });
    expect(String(refused?.body.error)).toContain("AC2");
    expect(String(refused?.body.do_instead)).toContain("norn done unverified --criteria");
    expect(accepted?.code).toBe(0);
  });

  test("at human QA, story view lists the unsettled verdict with its reason and how to check it", () => {
    expect(unitIn(atHumanQa)).toMatchObject({ step: "human-qa", waiting: { for: "gate" } });
    expect(atHumanQa.criteria).toHaveLength(1);
    expect(atHumanQa.criteria[0]?.verdicts).toEqual([expect.objectContaining({ id: "AC2", verdict: "unverified", reason: AC2.reason, how: AC2.how })]);
  });

  test("status names the open note at the gate and where to read it", () => {
    expect(statusMd).toContain(`1 open note: norn story view ${KEY}`);
  });

  test("notes stay open through a reject and join up; approve acknowledges them all", () => {
    expect(atHumanQa.notes.map((n) => n.text)).toEqual(["the first note: Save sits below the fold"]);
    expect(backAtHumanQa.notes.map((n) => n.text)).toEqual(["the first note: Save sits below the fold", "the second note: still no browser"]);
    expect(backAtHumanQa.notes.every((n) => n.criterion === "AC2")).toBe(true);
    expect(unitIn(atReady)).toMatchObject({ step: "ready", waiting: { for: "gate" } });
    expect(atReady.notes).toEqual([]);
    expect(atReady.criteria).toEqual([]);
  });

  test("the person's reject reaches QA's next brief, and the attempt rises", () => {
    expect(unitIn(backAtHumanQa).attempt).toBe(2);
    const second = briefs(w)[1] as string;
    expect(second).toContain("## Rework");
    expect(second).toContain("Save does nothing on Safari.");
  });
});

/** A check whose exit code and hold the test sets through files, each route back bounded at one. */
const checked = (dir: string) =>
  [
    "name: checked",
    "start: build",
    "steps:",
    "  build:",
    "    agent: Build the thing.",
    "    outcomes: { done: test }",
    "  test:",
    `    check: "while [ -f ${dir}/hold ]; do sleep 0.1; done; exit $(cat ${dir}/exit)"`,
    "    timeout: 1m",
    "    exits: { 3: stale }",
    "    outcomes: { pass: ready, fail: { to: build, max: 1 }, stale: refresh }",
    "  refresh:",
    "    gate: The base moved; approve to build again.",
    "    outcomes: { approve: build, reject: build }",
    "  ready:",
    "    gate: Approve the thing.",
    "    outcomes: { approve: $done, reject: { to: build, max: 1 } }",
    "",
  ].join("\n");

describe("checks routed by exit code, and counters run out and reset", () => {
  let w: World;
  let ticks: Ticks;
  let running: StorySeen;
  let runningStatus: { stories: { units: UnitSeen[] }[]; problems: string[] };
  let stale: UnitSeen;
  let rulesToStuck: string[];
  let stuckAtCheck: UnitSeen;
  let unknownReset: NornOut;
  let reset: NornOut;
  let atReady: UnitSeen;
  let stuckAtGate: UnitSeen;

  const exit = (code: number) => writeFileSync(join(w.dir, "exit"), String(code));

  beforeAll(async () => {
    w = await world("work");
    await setUp(w, { workflow: "checked", workflows: { checked: checked(w.dir) } });
    ticks = new Ticks(w);
    exit(3);
    writeFileSync(join(w.dir, "hold"), "");
    await norn(w, ["story", "create", "Checked", "--json"]);
    await ticks.until((u) => u?.step === "test" && u.run !== null);
    running = await view(w);
    runningStatus = (await norn(w, ["status", "--json"])).body as unknown as typeof runningStatus;
    rmSync(join(w.dir, "hold"));
    stale = await ticks.until(atGate("refresh"));
    exit(1);
    await norn(w, ["story", "approve", KEY, "--json"]);
    const from = ticks.rules.length;
    stuckAtCheck = await ticks.until((u) => u?.ended === "stuck");
    rulesToStuck = ticks.rules.slice(from);
    unknownReset = await norn(w, ["run", "rerun", KEY, "--reset", "nope", "--json"]);
    exit(0);
    const counter = (unknownReset.body.details as { counters: string[] }).counters.find((c) => c.startsWith("test.fail")) as string;
    reset = await norn(w, ["run", "rerun", KEY, "--step", "test", "--reset", counter, "--json"]);
    atReady = await ticks.until(atGate("ready"));
    await norn(w, ["story", "reject", KEY, "--reason", "Not yet.", "--json"]);
    await ticks.until(atGate("ready", 2));
    await norn(w, ["story", "reject", KEY, "--reason", "Still not.", "--json"]);
    stuckAtGate = await ticks.until((u) => u?.ended === "stuck");
  }, SLOW);

  test("while a check runs, status and story view show its run in progress and nothing waiting or stuck", () => {
    expect(unitIn(running)).toMatchObject({ step: "test", kind: "check", waiting: null });
    expect(unitIn(running).run).not.toBeNull();
    expect(running.problems).toEqual([]);
    expect(runningStatus.stories[0]?.units[0]).toMatchObject({ step: "test", waiting: null });
    expect(runningStatus.problems).toEqual([]);
  });

  test("an exit code the check maps to stale takes the stale route", () => {
    expect(stale).toMatchObject({ step: "refresh", waiting: { for: "gate" } });
  });

  test("exit 1 takes the fail route back to build, and the second fail runs the counter out, naming the rerun that resets it", () => {
    expect(rulesToStuck.filter((r) => r.startsWith("agent.start")).length).toBeGreaterThanOrEqual(2);
    expect(stuckAtCheck).toMatchObject({ step: "test", ended: "stuck" });
    expect(stuckAtCheck.ended_reason).toContain("ran out");
    expect(stuckAtCheck.waiting?.next).toBe(`norn run rerun ${KEY} --reset test.fail`);
  });

  test("--reset with an unknown counter is refused, naming the workflow's counters", () => {
    expect(refusal(unknownReset)).toMatchObject({ code: 3, code_name: "unknown_counter" });
    expect(String(unknownReset.body.do_instead)).toContain("test.fail");
    expect(unknownReset.body.details).toEqual({ counters: expect.arrayContaining(["test.fail", "ready.reject"]) });
  });

  test("a flaky check is rerun with --step test --reset, and passes on to the gate", () => {
    expect(reset.code).toBe(0);
    expect(reset.body).toMatchObject({ step: "test", reset: ["test.fail"] });
    expect(atReady).toMatchObject({ step: "ready", waiting: { for: "gate" } });
    // the reset counter is gone; the stale route spent its own
    expect(atReady.counters).toEqual({ "test.stale": { value: 1, max: 10 } });
  });

  test("a gate's reject counter run out ends the unit stuck at the gate, naming the rerun that resets it", () => {
    expect(stuckAtGate).toMatchObject({ step: "ready", ended: "stuck" });
    expect(stuckAtGate.waiting?.next).toBe(`norn run rerun ${KEY} --reset ready.reject`);
  });
});

/** Build, a check, and a review that sends it back on its own derived counter. */
const REVIEWED = [
  "name: reviewed",
  "start: build",
  "steps:",
  "  build:",
  "    agent: Build the thing.",
  "    outcomes: { done: test }",
  "  test:",
  "    check: test -f wip.txt || test -f feature.txt",
  "    timeout: 1m",
  "    outcomes: { pass: review, fail: build }",
  "  review:",
  "    agent: Review the thing.",
  "    hand_back: { changes_requested: findings }",
  "    outcomes: { done: $done, changes_requested: build }",
  "",
].join("\n");
/** REVIEWED as edited after the story pinned it: the loop now on a named counter. */
const REVIEWED_EDITED = REVIEWED.replace("changes_requested: build }", "changes_requested: { to: build, counter: loop } }\ncounters:\n  loop: { max: 5 }");

const alive = async (pid: number): Promise<boolean> => (await Bun.$`kill -0 ${pid}`.nothrow().quiet()).exitCode === 0;

describe("the review loop's derived counter, shown and reset on the pinned workflow", () => {
  let w: World;
  let ticks: Ticks;
  let atBuild: StorySeen;
  let statusMd: string;
  let pid: number;
  let unknownReset: NornOut;
  let rerun: NornOut;
  let rulesAfterRerun: string[];
  let ended: UnitSeen;

  beforeAll(async () => {
    w = await world("work");
    plans(w, { "review#1": "findings", "build#2": "hang" });
    await setUp(w, { workflow: "reviewed", workflows: { reviewed: REVIEWED } });
    ticks = new Ticks(w);
    await norn(w, ["story", "create", "Reviewed", "--json"]);
    await ticks.until((u) => u?.step === "build" && u.attempt === 2 && u.run !== null);
    for (const until = Date.now() + 20_000; Date.now() < until && agentNotes(w).filter((n) => n.note === "pid").length === 0; ) await Bun.sleep(100);
    pid = agentNotes(w).find((n) => n.note === "pid")?.value as number;
    atBuild = await view(w);
    statusMd = (await norn(w, ["status"])).stdout;
    // the story keeps the workflow it pinned; the file a person edits meanwhile is for new stories
    writeFileSync(join(w.root, ".agents", "workflows", "reviewed.yaml"), REVIEWED_EDITED);
    unknownReset = await norn(w, ["run", "rerun", KEY, "--reset", "nope", "--json"]);
    rerun = await norn(w, ["run", "rerun", KEY, "--step", "test", "--reset", "review.changes_requested", "--json"]);
    const from = ticks.rules.length;
    ended = await ticks.until((u) => u?.ended !== undefined);
    rulesAfterRerun = ticks.rules.slice(from);
  }, SLOW);

  test("a derived counter's value and bound show in story view and in status", () => {
    expect(unitIn(atBuild)).toMatchObject({ step: "build", attempt: 2 });
    expect(unitIn(atBuild).counters).toEqual({ "review.changes_requested": { value: 1, max: 3 } });
    expect(statusMd).toContain("review.changes_requested 1/3");
  });

  test("--reset with an unknown counter names the pinned workflow's, not the edited file's", () => {
    expect(refusal(unknownReset)).toMatchObject({ code: 3, code_name: "unknown_counter" });
    expect(String(unknownReset.body.do_instead)).toContain("review.changes_requested");
    expect((unknownReset.body.details as { counters: string[] }).counters).not.toContain("loop");
  });

  test("rerun --step test --reset review.changes_requested while build runs stops its agent, and the check passes on", async () => {
    expect(rerun.code).toBe(0);
    expect(rerun.body).toMatchObject({ from: "build", step: "test", reset: ["review.changes_requested"] });
    expect(rerun.body.stops_run).not.toBeNull();
    expect(await alive(pid)).toBe(false);
    expect(rulesAfterRerun.some((r) => r.startsWith("check."))).toBe(true);
    expect(ended).toMatchObject({ ended: "done", step: "review", attempt: 2 });
  });
});

/** One agent step and the gate after it. */
const SOLO_GATE = [
  "name: solo-gate",
  "start: build",
  "steps:",
  "  build:",
  "    agent: Build the thing.",
  "    outcomes: { done: ready }",
  "  ready:",
  "    gate: Approve the thing.",
  "    outcomes: { approve: $done, reject: build }",
  "",
].join("\n");

describe("an approve racing the tick that brings the unit to its gate", () => {
  let w: World;
  let machine: string;
  const tries: NornOut[] = [];
  let ended: UnitSeen;

  beforeAll(async () => {
    w = await world("work");
    const { added } = await setUp(w, { workflow: "solo-gate", workflows: { "solo-gate": SOLO_GATE } });
    machine = machineOf(added);
    const ticks = new Ticks(w);
    await norn(w, ["story", "create", "Raced", "--json"]);
    await ticks.until((u) => u?.step === "build" && u.run !== null);
    // two approves beside every tick, from the first tick that may apply the report until one lands
    for (const until = performance.now() + 90_000; performance.now() < until && !tries.some((t) => t.code === 0); ) {
      const [, a, b] = await Promise.all([ticks.once(), norn(w, ["story", "approve", KEY, "--json"]), norn(w, ["story", "approve", KEY, "--json"])]);
      tries.push(a, b);
    }
    ended = await ticks.until((u) => u?.ended !== undefined);
  }, SLOW);

  test("each approve either lands or is refused as not at the gate", () => {
    expect(tries.some((t) => t.code === 0)).toBe(true);
    for (const t of tries) if (t.code !== 0) expect(refusal(t)).toMatchObject({ code: 3, code_name: "not_at_gate" });
  });

  test("the decision is recorded exactly once, on the gate step, and the story ends done", () => {
    const decided = receiptsOf(machine, "gate.decided").map((r) => r.data as Record<string, unknown>);
    expect(decided).toEqual([expect.objectContaining({ outcome: "approve", step: "ready", attempt: 1 })]);
    expect(ended).toMatchObject({ ended: "done", step: "ready" });
  });
});
