/**
 * Property tests for receipt application (S5, S6, W3, W4, C1) and the one-action rule (O5).
 *
 * A seeded in-repo PRNG (mulberry32) builds random workflows — agent, check, gate and git steps,
 * forward edges to the next step and counted back edges with small `max` — and random receipt
 * sequences against them, each receipt built against the cursor of the state before it (with a
 * share of stale, undeclared and wrong-kind receipts so rejection paths run too). Every run is
 * reproducible from its seed; a failure names the seed. `NORN_PROPERTY_SEED` / `NORN_PROPERTY_RUNS`
 * explore other seeds locally (the defaults are what CI runs); `NORN_PROPERTY_RULES=1` prints the
 * decide rules the random Facts reached.
 *
 * Invariants:
 *   - counters never exceed their max (W4), and the set of counters is the declared one
 *   - every state is schema-valid and its status agrees with its park (S2, §10)
 *   - applying all receipts in one batch equals applying them one at a time (S6)
 *   - applying the same receipts twice — or a prefix, then all of them (crash replay) — changes nothing (S6)
 *   - decide emits at most one action per unit per tick (O5), over Facts built from random states
 *   - the route `routeFor` records in a classify receipt matches where `applyReceipts` sends the
 *     unit: holds while the outcome's counter / nudges / retries have room; `test.failing` overall
 *     until BUG-2 (refactor plan 1.2) — `routeFor` ignores exhaustion
 */
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CONFIG,
  deriveUlid,
  type GitAction,
  type LeaseFile,
  type Receipt,
  type ResolvedConfig,
  type Step,
  type UnitState,
  validate,
  type Workflow,
} from "@norn/schema";
import { type ApplyContext, type ApplyResult, applyReceipts, routeFor } from "../src/apply.ts";
import { decide, isSideAction, type RepoWorkflows } from "../src/decide.ts";
import type { Facts, NumberedReceipt, RunFacts, StoryFacts, UnitFacts, UnitRef } from "../src/facts.ts";
import { checkWorkflowLevel, OVERRIDABLE_ROUTES, reportableOutcomes, stepOf, validateWorkflowDefinition } from "../src/workflow.ts";
import { at, facts, loaded, numbered, sliceFile, sliceUnit, stateFor, storyFacts, storyUnit, T0, unitFacts } from "./fixtures.ts";

// ================================================================= PRNG

/** mulberry32: small, fast, good enough to explore state spaces; deterministic per seed. */
function rngFrom(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  return {
    int,
    /** integer in [lo, hi] */
    range: (lo: number, hi: number) => lo + int(hi - lo + 1),
    chance: (p: number) => next() < p,
    pick: <T>(xs: readonly T[]): T => {
      if (!xs.length) throw new Error("pick from empty list");
      return xs[int(xs.length)] as T;
    },
    subset: <T>(xs: readonly T[]): T[] => xs.filter(() => next() < 0.5),
  };
}
type Rng = ReturnType<typeof rngFrom>;

const BASE_SEED = Number(process.env.NORN_PROPERTY_SEED ?? 20261027);
const RUNS = Number(process.env.NORN_PROPERTY_RUNS ?? 300);
/** Run `body` per seed; the first failing seed is named, with the env that replays just that run. */
function forSeeds(salt: number, body: (rng: Rng, seed: number) => void): void {
  for (let i = 0; i < RUNS; i++) {
    const seed = (BASE_SEED + i + salt * 1_000_003) >>> 0;
    try {
      body(rngFrom(seed), seed);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`seed ${seed} (replay: NORN_PROPERTY_SEED=${BASE_SEED + i} NORN_PROPERTY_RUNS=1): ${msg}`);
    }
  }
}

// ================================================================= random workflows

const STEP_NAMES = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];
const LIMITS = { nudges: 2, retries: 1 };

/**
 * A valid workflow (W5): steps in a line, each with a forward edge to the next (the last to
 * `$done`), plus counted back edges (to itself or an earlier step), so every cycle is counted (W4)
 * and `$done` is reachable. Git actions fit the unit level (W8).
 */
function randomWorkflow(rng: Rng, name: string, level: "story" | "slice"): Workflow {
  const n = rng.range(2, 5);
  const names = STEP_NAMES.slice(0, n);
  const counterNames = Array.from({ length: rng.range(1, 2) }, (_, i) => `loop_${i}`);
  const counted = (i: number) => ({ to: names[rng.int(i + 1)] as string, counter: rng.pick(counterNames) });
  const forward: string[] = [];
  const steps: Record<string, Step> = {};
  for (let i = 0; i < n; i++) {
    const self = names[i] as string;
    const next = i + 1 < n ? (names[i + 1] as string) : "$done";
    const kind = rng.pick(["agent", "agent", "check", "gate", "git"] as const);
    if (kind === "agent") {
      const outcomes: Record<string, unknown> = { done: next };
      forward.push(`${self}.done`);
      if (rng.chance(0.6)) outcomes.rework = counted(i);
      if (rng.chance(0.3)) outcomes.partial = next;
      // C1: a step may override a classified route
      if (rng.chance(0.2)) outcomes[rng.pick(OVERRIDABLE_ROUTES)] = rng.pick([next, "$stuck"]);
      const step: Record<string, unknown> = { type: "agent", skill: "work", outcomes };
      if (rng.chance(0.5)) step.nudges = rng.range(0, 2);
      if (rng.chance(0.5)) step.retries = rng.range(0, 2);
      if (rng.chance(0.1)) step.attended = true;
      steps[self] = step as Step;
    } else if (kind === "check") {
      const outcomes: Record<string, unknown> = { pass: next };
      forward.push(`${self}.pass`);
      if (rng.chance(0.8)) outcomes.fail = counted(i);
      steps[self] = { type: "check", run: "bun test", timeout: "5m", outcomes } as Step;
    } else if (kind === "gate") {
      const outcomes: Record<string, unknown> = { approve: next };
      forward.push(`${self}.approve`);
      if (rng.chance(0.7)) outcomes.reject = counted(i);
      if (level === "story" && rng.chance(0.4)) outcomes.stale = counted(i);
      steps[self] = { type: "gate", prompt: `decide ${self}`, outcomes } as Step;
    } else {
      const actions: GitAction[] = level === "story" ? ["push", "open-pr", "update"] : ["integrate", "push"];
      const outcomes: Record<string, unknown> = { done: next };
      forward.push(`${self}.done`);
      if (rng.chance(0.7)) outcomes.conflict = counted(i);
      steps[self] = { type: "git", action: rng.pick(actions), outcomes } as Step;
    }
  }
  const counters: NonNullable<Workflow["counters"]> = {};
  for (const c of counterNames) counters[c] = { max: rng.range(1, 3), ...(rng.chance(0.25) ? { reset_on: rng.pick(forward) } : {}) };
  const wf: Workflow = { name, start: names[0] as string, steps, counters };
  const check = validateWorkflowDefinition(wf);
  const level_ = checkWorkflowLevel(wf, level);
  if (!check.ok || level_.length) throw new Error(`generator made an invalid workflow: ${JSON.stringify([...check.issues, ...level_])}\n${JSON.stringify(wf)}`);
  return wf;
}

// ================================================================= random receipts

/** Receipt ids and run ids: deterministic per seed. */
function idsFor(seed: number) {
  let i = 0;
  const base = deriveUlid("01JEEEEEEEEEEEEEEEEEEEEEEE", seed);
  return () => deriveUlid(base, i++);
}

type Gen = { rng: Rng; id: () => string; tick: number };

/** Time of the k-th receipt: monotonic, before T0. */
const atK = (g: Gen) => at(T0 - 3_600_000 + g.tick++ * 1000);

/**
 * One receipt against the cursor of `st`: mostly one the cursor accepts, sometimes not — stale
 * attempt, wrong kind for the step, undeclared outcome, or any kind at `$done`.
 */
function randomReceipt(g: Gen, st: UnitState, wf: Workflow): Receipt {
  const { rng } = g;
  const head = (by: "agent" | "human" | "norn") => ({ receipt_id: g.id(), run_id: st.run?.run_id ?? null, step: st.step, attempt: st.attempt, at: atK(g), by });
  const r = pickReceipt(g, st, wf, head);
  if (rng.chance(0.05) && r.kind !== "mode" && r.kind !== "take") return { ...r, attempt: r.attempt + 1 } as Receipt; // stale (T9)
  return r;
}

function pickReceipt(g: Gen, st: UnitState, wf: Workflow, head: (by: "agent" | "human" | "norn") => Record<string, unknown>): Receipt {
  const { rng } = g;
  const make = (kind: Receipt["kind"], by: "agent" | "human" | "norn", body: Record<string, unknown>) => ({ kind, ...head(by), ...body }) as unknown as Receipt;
  const classify = (outcome: string) =>
    make("classify", "norn", { outcome, rule: `prop.${outcome}`, detail: outcome, route: routeFor(wf, st.step, outcome) }); // as act writes it
  const unstick = () => {
    const body: Record<string, unknown> = {};
    if (rng.chance(0.5)) body.to = rng.pick(Object.keys(wf.steps));
    const reset = rng.subset(Object.keys(wf.counters ?? {}));
    if (reset.length) body.reset = reset;
    return make("unstick", "human", body);
  };
  if (rng.chance(0.04)) {
    const mode = rng.pick(["auto", "manual"] as const);
    return make("mode", "human", { mode, previous: mode === "auto" ? "manual" : "auto" });
  }
  if (st.step === "$done" || st.status === "done") return rng.chance(0.5) ? classify("done") : unstick();
  if (st.status === "stuck") return rng.chance(0.85) ? unstick() : classify("done");
  if (st.status === "parked") {
    switch (st.park?.kind) {
      case "ask":
        return rng.chance(0.8) ? make("answer", rng.pick(["human", "agent"] as const), { answer: "yes", ...(rng.chance(0.3) ? { delivered: true } : {}) }) : unstick();
      case "gate":
        return rng.pick([
          () => make("approve", "human", {}),
          () => make("reject", "human", {}),
          () => classify("stale"),
          () => unstick(),
        ])();
      case "attended":
        return rng.chance(0.8) ? started(g, make) : unstick();
      default:
        return unstick();
    }
  }
  const step = stepOf(wf, st.step) as Step;
  switch (step.type) {
    case "agent": {
      // silent / timeout / stalled are classified only for a running unit (decide: classifyRun)
      if (st.status !== "running") return rng.chance(0.9) ? started(g, make) : classify("died");
      const declared = reportableOutcomes(step);
      return rng.pick([
        () => make("done", "agent", { outcome: rng.chance(0.9) ? rng.pick(declared) : "undeclared", handoff: "h" }),
        () => make("done", "agent", { outcome: rng.pick(declared), handoff: "h" }),
        () => make("ask", "agent", { question: "which way?" }),
        () => make("stuck", "agent", { reason: "blocked" }),
        () => classify(rng.pick(["silent", "timeout", "stalled", "died", "died", "ask", "exhausted"])),
        () => started(g, make),
      ])();
    }
    case "check":
      if (rng.chance(0.75)) {
        const outcome = rng.pick(["pass", "fail"] as const);
        return make("check", "norn", { outcome, command: "bun test", exit_code: outcome === "pass" ? 0 : 1, duration_ms: 5, output_tail: "" });
      }
      return classify(rng.pick(["pass", "fail", "exhausted", "silent"]));
    case "git":
      return classify(rng.pick(["done", "conflict", "conflict", "stuck", "exhausted"]));
    default:
      return rng.chance(0.5) ? make("approve", "human", {}) : classify("done");
  }
}

function started(g: Gen, make: (kind: Receipt["kind"], by: "agent" | "human" | "norn", body: Record<string, unknown>) => Receipt): Receipt {
  const { rng } = g;
  const run_id = g.id();
  const auto = rng.chance(0.6);
  const body: Record<string, unknown> = { how: auto ? "auto" : "manual", worktree: "/w" };
  if (auto && rng.chance(0.7)) body.session = { runner: "headless", session_id: run_id };
  if (auto) body.agent_session_id = `cs-${run_id.slice(-4)}`;
  const r = make("started", auto ? "norn" : "human", body) as Receipt & { run_id: string | null };
  return { ...r, run_id } as Receipt;
}

// ================================================================= invariants

function expectCounters(st: UnitState, wf: Workflow): void {
  const declared = wf.counters ?? {};
  expect(Object.keys(st.counters).sort()).toEqual(Object.keys(declared).sort());
  for (const [name, spec] of Object.entries(declared)) {
    const v = st.counters[name] as number;
    if (!(Number.isInteger(v) && v >= 0 && v <= spec.max)) throw new Error(`counter ${name} = ${v}, max ${spec.max} (W4)`);
  }
}

function expectWellFormed(st: UnitState): void {
  const v = validate("state", st);
  if (!v.ok) throw new Error(`state fails its schema: ${JSON.stringify(v.errors)}\n${JSON.stringify(st)}`);
  const parkedLike = st.status === "parked" || st.status === "stuck";
  if (parkedLike !== (st.park !== null)) throw new Error(`status ${st.status} with park ${JSON.stringify(st.park)}`);
  // GR7: a finished story whose issue changed (closed, unassigned) is parked `remote` at `$done`
  const remoteAtDone = st.step === "$done" && st.status === "stuck" && st.park?.kind === "remote";
  if ((st.step === "$done") !== (st.status === "done") && !remoteAtDone) throw new Error(`step ${st.step} with status ${st.status}`);
  if (st.status === "running" && !st.run) throw new Error(`running without a run: ${JSON.stringify(st.last_outcome)}`);
}

interface Episode {
  wf: Workflow;
  initial: UnitState;
  receipts: NumberedReceipt[];
  /** state after each receipt, applied one at a time */
  states: UnitState[];
  /** per receipt: the state before it and the one-receipt result */
  steps: { before: UnitState; nr: NumberedReceipt; res: ApplyResult }[];
}

const ctxFor = (wf: Workflow): ApplyContext => ({ workflow: wf, now: at(), limits: LIMITS, tick_id: "01JAAAAAAAAAAAAAAAAAAAAAAA" });

/** A random unit history: a workflow and receipts applied one at a time, each built on the state before it. */
function episode(rng: Rng, seed: number, unit: UnitRef = sliceUnit("gh-1", "01", "form"), level: "story" | "slice" = "slice", wfName = "prop"): Episode {
  const wf = randomWorkflow(rng, wfName, level);
  const g: Gen = { rng, id: idsFor(seed), tick: 0 };
  const initial = stateFor(unit, wf);
  const ctx = ctxFor(wf);
  const receipts: NumberedReceipt[] = [];
  const states: UnitState[] = [];
  const steps: Episode["steps"] = [];
  let st = initial;
  const len = rng.range(1, 30);
  for (let n = 1; n <= len; n++) {
    const r = randomReceipt(g, st, wf);
    const v = validate("receipt", r);
    if (!v.ok) throw new Error(`generator made an invalid receipt: ${JSON.stringify(v.errors)}\n${JSON.stringify(r)}`);
    const nr = numbered(n, r);
    const res = applyReceipts(st, [nr], ctx);
    receipts.push(nr);
    steps.push({ before: st, nr, res });
    st = res.state;
    states.push(st);
    if (st.status === "done" && rng.chance(0.7)) break;
  }
  return { wf, initial, receipts, states, steps };
}

/** Where `applyReceipts` sent the unit for one applied receipt, in `route` terms (§10). */
function whereSent(res: ApplyResult): string | null {
  if (res.route) return res.route;
  if (res.advance) return res.advance.to;
  if (res.state.status === "stuck") return "$stuck";
  if (res.state.status === "parked" && res.state.park?.kind === "ask") return "park";
  return null;
}

/** C1/W4: the outcome hit a limit — a counted edge, nudges or retries with no room left. */
const exhausted = (res: ApplyResult) => res.state.status === "stuck" && res.state.park?.kind === "exhausted";

/** Applied classify receipts whose recorded route disagrees with where apply sent the unit. */
function routeMismatches(ep: Episode, filter: (res: ApplyResult) => boolean) {
  const out: string[] = [];
  for (const { before, nr, res } of ep.steps) {
    const r = nr.receipt;
    if (r.kind !== "classify" || !res.applied.length || !filter(res)) continue;
    const went = whereSent(res);
    if (r.route !== went)
      out.push(`${before.step}#${before.attempt} classify ${r.outcome}: recorded route ${r.route}, apply sent it to ${went} (${res.log.join("; ")})`);
  }
  return out;
}

// ================================================================= apply properties

describe("applyReceipts properties (S6, W4, C1)", () => {
  test("the generators make valid workflows and receipts, and reach every step type, park kind and limit", () => {
    const seen = new Set<string>();
    forSeeds(0, (rng, seed) => {
      const ep = episode(rng, seed);
      for (const s of Object.values(ep.wf.steps)) seen.add(`step:${s.type}`);
      for (const { res, nr } of ep.steps) {
        seen.add(`receipt:${nr.receipt.kind}:${res.applied.length ? "applied" : "rejected"}`);
        if (res.state.park) seen.add(`park:${res.state.park.kind}`);
        if (res.route) seen.add(`route:${res.route}`);
        if (res.advance?.counter) seen.add("counted");
        if (res.advance?.reset) seen.add("reset");
        if (res.state.status === "done") seen.add("done");
      }
    });
    // the properties below mean little unless the random histories reach these
    for (const want of [
      "step:agent", "step:check", "step:gate", "step:git",
      "park:ask", "park:gate", "park:attended", "park:stuck", "park:exhausted",
      "route:nudge", "route:retry", "counted", "reset", "done",
      "receipt:started:applied", "receipt:done:applied", "receipt:done:rejected", "receipt:check:applied",
      "receipt:classify:applied", "receipt:classify:rejected", "receipt:approve:applied", "receipt:reject:applied",
      "receipt:answer:applied", "receipt:unstick:applied", "receipt:ask:applied", "receipt:stuck:applied", "receipt:mode:applied",
    ])
      expect(seen).toContain(want);
  });

  test("counters never exceed their max, and every state is well formed", () => {
    forSeeds(1, (rng, seed) => {
      const ep = episode(rng, seed);
      expectCounters(ep.initial, ep.wf);
      expectWellFormed(ep.initial);
      for (const st of ep.states) {
        expectCounters(st, ep.wf);
        expectWellFormed(st);
      }
    });
  });

  test("every receipt is either applied or rejected, and applied_through moves past it", () => {
    forSeeds(2, (rng, seed) => {
      const ep = episode(rng, seed);
      for (const { nr, res } of ep.steps) {
        expect([...res.applied, ...res.rejected.map((x) => x.n)]).toEqual([nr.n]);
        expect(res.state.applied_through).toBe(nr.n);
      }
    });
  });

  test("applying the receipts in one batch equals applying them one at a time", () => {
    forSeeds(3, (rng, seed) => {
      const ep = episode(rng, seed);
      const batch = applyReceipts(ep.initial, ep.receipts, ctxFor(ep.wf));
      expect(batch.state).toEqual(ep.states.at(-1) as UnitState);
      expect(batch.applied).toEqual(ep.steps.flatMap((s) => s.res.applied));
      expect(batch.rejected).toEqual(ep.steps.flatMap((s) => s.res.rejected));
    });
  });

  test("applying the same receipts twice changes nothing — also after a crash mid-way (replay of a prefix)", () => {
    forSeeds(4, (rng, seed) => {
      const ep = episode(rng, seed);
      const ctx = ctxFor(ep.wf);
      const once = applyReceipts(ep.initial, ep.receipts, ctx);
      const twice = applyReceipts(once.state, ep.receipts, ctx);
      expect(twice.state).toEqual(once.state);
      expect({ applied: twice.applied, rejected: twice.rejected, advance: twice.advance, route: twice.route, deliver: twice.deliver }).toEqual({
        applied: [],
        rejected: [],
        advance: null,
        route: null,
        deliver: null,
      });
      // S6: state.json written after receipts 1..k, then the tick replays all of them
      const k = rng.int(ep.receipts.length + 1);
      const prefix = applyReceipts(ep.initial, ep.receipts.slice(0, k), ctx);
      const replay = applyReceipts(prefix.state, ep.receipts, ctx);
      expect(replay.state).toEqual(once.state);
      // shuffled input order: the fold sorts by number
      const shuffled = [...ep.receipts].sort(() => rng.int(3) - 1);
      expect(applyReceipts(ep.initial, shuffled, ctx).state).toEqual(once.state);
    });
  });

  test("routeFor matches where applyReceipts sends the unit while the outcome has room (no limit hit)", () => {
    let compared = 0;
    forSeeds(5, (rng, seed) => {
      const ep = episode(rng, seed);
      compared += ep.steps.filter(({ nr, res }) => nr.receipt.kind === "classify" && res.applied.length && !exhausted(res)).length;
      expect(routeMismatches(ep, (res) => !exhausted(res))).toEqual([]);
    });
    expect(compared).toBeGreaterThan(100);
  });

  // BUG-2 (refactor plan 1.2): `routeFor` reads only the edge, so an outcome whose counted edge,
  // nudges or retries are used up is recorded as the edge's target / `nudge` / `retry` while apply
  // parks the unit exhausted → `$stuck`. Flip to `test` with the fix (`routeOf(res)`).
  test.failing("routeFor matches where applyReceipts sends the unit, limits included (BUG-2)", () => {
    forSeeds(5, (rng, seed) => {
      expect(routeMismatches(episode(rng, seed), () => true)).toEqual([]);
    });
  });
});

// ================================================================= decide: one action per unit (O5)

const KEYS = ["gh-1", "gh-2", "gh-3"];

/** A unit's facts from a random history; sometimes with receipts not applied yet, a run, a lease. */
function randomUnit(rng: Rng, seed: number, unit: UnitRef, level: "story" | "slice", wfName: string): { uf: UnitFacts; wf: Workflow } {
  const ep = episode(rng, seed, unit, level, wfName);
  const fresh = level === "story" && rng.chance(0.1);
  let st: UnitState | null = fresh ? null : ep.states[rng.int(ep.states.length)] ?? ep.initial;
  const uf = unitFacts(unit, fresh ? null : ep.wf, st);
  if (!st) return { uf, wf: ep.wf };
  if (rng.chance(0.25)) {
    // receipts written since the last tick (C2), built against the cursor
    const g: Gen = { rng, id: idsFor(seed + 7919), tick: 100 };
    let cur = st;
    for (let i = 0; i < rng.range(1, 2); i++) {
      const r = randomReceipt(g, cur, ep.wf);
      const nr = numbered(st.applied_through + 1 + i, r);
      uf.unapplied.push(nr);
      cur = applyReceipts(cur, [nr], ctxFor(ep.wf)).state;
    }
  }
  if (st.run) {
    const run = st.run;
    if (rng.chance(0.7)) {
      const rf: RunFacts = {
        run_id: run.run_id,
        session: run.session ? { runner: run.session.runner, session_id: run.session.session_id } : null,
        process_alive: rng.pick([true, false, null]),
        pane: null,
        hooks: [],
        last_hook_at: null,
        last_activity_at: rng.chance(0.8) ? T0 - rng.range(0, 90) * 60_000 : null,
        transcript: null,
      };
      uf.run = rf;
    }
    if (rng.chance(0.5)) uf.lease = { version: 1, kind: "agent", repo: "/r", story: unit.story, slice: unit.slice, run_id: run.run_id, holder: { pid: 7, pid_start: "x" }, created_at: at() };
  }
  if (rng.chance(0.1)) uf.uncommitted = true;
  if (rng.chance(0.1)) uf.worktree = null;
  if (rng.chance(0.05)) st = { ...st, mode: rng.pick(["auto", "manual"] as const) };
  uf.state = st;
  return { uf, wf: ep.wf };
}

function randomFacts(rng: Rng, seed: number): { f: Facts; workflows: RepoWorkflows; config: ResolvedConfig } {
  const workflows: Record<string, ReturnType<typeof loaded>> = {};
  const stories: StoryFacts[] = [];
  const leases: LeaseFile[] = [];
  const nStories = rng.range(1, 3);
  for (let s = 0; s < nStories; s++) {
    const key = KEYS[s] as string;
    const name = `story-${s}`;
    const story = randomUnit(rng, seed * 31 + s, storyUnit(key), "story", name);
    workflows[name] = loaded(story.wf);
    const units = [story.uf];
    const slices = [];
    for (let k = 0; k < rng.range(0, 2); k++) {
      const nn = `0${k + 1}`;
      const sname = `slice-${s}-${k}`;
      const sl = randomUnit(rng, seed * 31 + s * 7 + k + 1, sliceUnit(key, nn, `part${k}`), "slice", sname);
      workflows[sname] = loaded(sl.wf);
      units.push(sl.uf);
      slices.push(sliceFile(key, nn, `part${k}`, [], sl.uf.state?.status === "done" && rng.chance(0.5) ? "integrated" : "active", sname));
    }
    for (const u of units) if (u.lease) leases.push(u.lease);
    const base = storyFacts(key, [], {}, T0 - 3_600_000 + s);
    const fm = { ...base.frontmatter!, workflow: name, status: story.uf.state ? ("active" as const) : rng.pick(["new", "active"] as const) };
    const claim = rng.chance(0.85) ? base.claim : rng.pick([{ state: "none" as const }, { ...(base.claim as Extract<StoryFacts["claim"], { state: "mine" }>), state: "expired" as const }]);
    const patch: Partial<StoryFacts> = { frontmatter: fm, slices, claim, mode: rng.pick(["auto", "auto", "manual"] as const) };
    if (rng.chance(0.2)) patch.base = { ref: "origin/main", sha: "b".repeat(40), head: "c".repeat(40), merge_base: "d".repeat(40), behind: rng.range(0, 3), ahead: 1, conflicts: rng.chance(0.5) ? ["a.ts"] : [] };
    if (rng.chance(0.05) && base.issue) patch.issue = { ...base.issue, state: "closed" };
    stories.push(storyFacts(key, units, patch, T0 - 3_600_000 + s));
  }
  const runner = rng.pick(["herdr", "headless"]);
  const f = facts(stories);
  const machine = {
    ...f.machine,
    runner,
    runner_capabilities: runner === "herdr" ? { send: true, resume: false } : { send: false, resume: true },
    leases,
  };
  const config: ResolvedConfig = { ...DEFAULT_CONFIG, runner: { adapter: runner }, max_agents: rng.range(1, 3), max_checks: rng.range(1, 2) };
  return { f: { ...f, machine }, workflows, config };
}

describe("decide properties (O5, W4)", () => {
  test("at most one action per unit, and every state it writes keeps counters within max", () => {
    const rules = new Set<string>();
    forSeeds(6, (rng, seed) => {
      const { f, workflows, config } = randomFacts(rng, seed);
      // decide throws on a second action for a unit; a throw of any kind fails the property
      const decisions = decide(f, workflows, config);
      const perUnit = new Map<string, string[]>();
      for (const d of decisions) {
        rules.add(d.rule);
        if (isSideAction(d.action) || d.unit === "*") continue;
        perUnit.set(d.unit, [...(perUnit.get(d.unit) ?? []), d.rule]);
      }
      for (const [unit, rs] of perUnit) if (rs.length > 1) throw new Error(`${unit}: ${rs.length} actions (${rs.join(", ")})`);
      for (const d of decisions) {
        const state = (d.action as { state?: UnitState | null }).state;
        if (!state || !d.action.unit) continue;
        const uf = f.stories.flatMap((s) => s.units).find((u) => u.unit.key === d.unit);
        const wf = uf?.workflow ?? (workflows[f.stories.find((s) => s.key === d.unit)?.frontmatter?.workflow ?? ""]?.workflow as Workflow | undefined);
        if (wf) expectCounters(state, wf);
        try {
          expectWellFormed(state);
        } catch (e) {
          throw new Error(`${d.rule}: ${(e as Error).message}`);
        }
      }
    });
    if (process.env.NORN_PROPERTY_RULES) console.log([...rules].sort().join(" "));
    // the random facts reach the unit-level rules that move a cursor, not only noops
    for (const want of ["receipts.apply", "check.run", "agent.start", "unit.parked.gate"]) expect([...rules].some((r) => r.startsWith(want))).toBe(true);
  });
});
