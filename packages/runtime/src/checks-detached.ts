/**
 * Checks outside the tick. `run_check` starts the command detached (`ctx.spawn`) inside a small
 * shell wrapper and returns at once; the step run is recorded `running` with the process's handle,
 * log and deadline. The wrapper writes the exit file when the command exits (temp file, then `mv`,
 * so a reader sees all of it or none). Facts then read:
 * - exit file present: finished, the outcome from the exit code (checkOutcome) and the log's tail;
 * - no exit file, past the deadline: timed out, outcome `fail`; the tick stops it when it still runs;
 * - no exit file, process alive, before the deadline: running;
 * - no exit file, process gone: died, a failed outcome with the reason.
 * A finished, timed-out or died read hands back the settled record, which facts write once, so
 * the outcome stays put after the process and its files are gone.
 *
 * The record is written `running` before the spawn, with no handle yet, and the wrapper's first act
 * is to leave its pid beside the exit file. A replay that finds such a record never spawns again: the
 * pid file names the process the crashed start made, and without one the spawn never ran (a replay
 * comes a tick later, long after any wrapper that did start had written it). Facts read a record with
 * neither handle nor pid file as cut short only once CHECK_START_GRACE_MS has passed since it was
 * written, so no reader writes off a start still in flight.
 */
import type { DecisionOf, StepRunFacts } from "@norn/kernel";
import { fail, type HostContext, hostProcesses, ok, parseJson, type PluginResult } from "@norn/plugin-api";
import { IsoTime } from "@norn/schema";
import { type Static, Type } from "@sinclair/typebox";
import { ensureWorktree } from "./branches.ts";
import { checkCommandOf } from "./check-command.ts";
import type { TickContext } from "./env.ts";
import { unitInFacts } from "./record.ts";
import { readStepRun, type StepRunRecord, writeStepRun } from "./step-runs.ts";
import { CHECK_WAKE_WRITER, wakePath } from "./wake.ts";

/** What the wrapper leaves when the command exits. */
export const CheckExit = Type.Object(
  { exit: Type.Integer({ minimum: 0, maximum: 255 }), finished_at: IsoTime },
  { additionalProperties: false, title: "CheckExit" },
);
export type CheckExit = Static<typeof CheckExit>;

/** How much of a check's output is kept for the step that reworks it: the end, where a test runner sums up. */
export const OUTPUT_TAIL = 8000;

/** `pass` on exit 0, the outcome `exits` names for the code, else `fail`; a timeout has no exit and fails. */
export function checkOutcome(exits: Readonly<Record<string, string>>, code: number, timedOut: boolean): string {
  if (timedOut) return "fail";
  if (code === 0) return "pass";
  return exits[String(code)] ?? "fail";
}

/** A unit's check exits and logs, each file named `<run>-<attempt>`, so a run's files are found by its id. */
export const checkExitsDir = (ctx: HostContext, unit: string): string => `${ctx.repo.dataDir}/runtime/check-exits/${unit.replace("/", "-")}`;
export const checkLogsDir = (ctx: HostContext, unit: string): string => `${ctx.repo.dataDir}/runtime/check-logs/${unit.replace("/", "-")}`;

export function checkExitPath(ctx: HostContext, unit: string, runId: string, attempt: number): string {
  return `${checkExitsDir(ctx, unit)}/${runId}-${attempt}.json`;
}

export function checkLogPath(ctx: HostContext, unit: string, runId: string, attempt: number): string {
  return `${checkLogsDir(ctx, unit)}/${runId}-${attempt}.log`;
}

export function checkPidPath(ctx: HostContext, unit: string, runId: string, attempt: number): string {
  return `${checkExitPath(ctx, unit, runId, attempt)}.pid`;
}

// the command and the exit path arrive as positional arguments, never spliced into the script, so
// no quoting in either can change what the wrapper runs
const WRAPPER = [
  'mkdir -p "$(dirname "$2")" && echo $$ > "$2.pid.tmp" && mv -f "$2.pid.tmp" "$2.pid"',
  'sh -c "$1"',
  "code=$?",
  'mkdir -p "$(dirname "$2")" || exit 1',
  `printf '{"exit":%d,"finished_at":"%s"}\\n' "$code" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$2.tmp" && mv -f "$2.tmp" "$2"`,
  // after the exit file, so a watch woken by the stamp finds the check finished; best effort, as the stamp is only a hint
  `{ mkdir -p "$(dirname "$3")" && printf '${CHECK_WAKE_WRITER} %s\\n' "$2" > "$3.$$.tmp" && mv -f "$3.$$.tmp" "$3"; } 2>/dev/null || true`,
].join("\n");

/** The argv that runs `command`, writes the exit file once it exits, then stamps the wake file. */
export function checkWrapperArgv(command: string, exitPath: string, wakeFile: string): string[] {
  return ["sh", "-c", WRAPPER, "norn-check", command, exitPath, wakeFile];
}

/** A detached check's handle: `<pid>@<start marker>`; the marker is opaque, so only the first `@` splits. */
export function encodeCheckHandle(pid: number, started: string): string {
  return `${pid}@${started}`;
}

/** The handle's pid and start marker; an empty marker (a process found by its pid file) matches the pid alone. */
export function decodeCheckHandle(handle: string): { pid: number; started?: string } | null {
  const at = handle.indexOf("@");
  if (at < 1) return null;
  const pid = Number(handle.slice(0, at));
  if (!Number.isInteger(pid) || pid < 1) return null;
  const started = handle.slice(at + 1);
  return started === "" ? { pid } : { pid, started };
}

/** Whether this host can run a check detached; one that cannot runs it inside the tick. */
export function canDetach(ctx: HostContext): boolean {
  return hostProcesses(ctx).ok;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function exitsOf(t: TickContext, unit: string, step: string): Record<string, string> {
  const state = unitInFacts(t.facts, unit)?.state;
  return state ? { ...(t.workflows.byHash[state.workflow.hash]?.graph.steps[step]?.check?.exits ?? {}) } : {};
}

/** Start the check detached and record it running; a replay that finds it recorded starts nothing. */
export async function startDetachedCheck(t: TickContext, d: DecisionOf<"run_check">): Promise<PluginResult<unknown>> {
  if (d.unit === null) throw new Error(`${d.rule}: a unit decision without a unit`);
  const unit = d.unit;
  const { ctx } = t.env;
  const procs = hostProcesses(ctx);
  if (!procs.ok) return fail("unavailable", `this host cannot run a check detached: it lacks ${procs.missing.join(", ")}`, false);
  const worktree = await ensureWorktree(t.env, unit);
  if (!worktree.ok) return worktree;
  const intent = d.intent;
  let reused = false;
  const perform = async (): Promise<PluginResult<StepRunRecord>> => {
    const prior = await readStepRun(ctx, unit);
    const exitPath = checkExitPath(ctx, unit, d.run_id, d.attempt);
    const pidPath = checkPidPath(ctx, unit, d.run_id, d.attempt);
    const ours = prior !== null && intent !== undefined && prior.intent_id === intent.id;
    if (ours && (prior.handle !== undefined || prior.outcome !== undefined || prior.error !== undefined)) {
      reused = true;
      return ok(prior);
    }
    if (ours && prior.running === true) {
      // a start cut short after its record: the pid file says whether it spawned
      const handle = await handleFromPidFile(ctx, prior);
      if (handle !== null) {
        reused = true;
        const found: StepRunRecord = { ...prior, handle };
        await writeStepRun(ctx, found);
        return ok(found);
      }
      return spawnInto(prior);
    }
    const log = checkLogPath(ctx, unit, d.run_id, d.attempt);
    // a rerun goes under the same run and attempt: what the cut-short run left must not read as this one's
    await ctx.files.remove(exitPath);
    await ctx.files.remove(pidPath);
    await ctx.files.remove(log);
    const base: StepRunRecord = {
      unit,
      run_id: d.run_id,
      ...(intent ? { intent_id: intent.id } : {}),
      step: d.step,
      attempt: d.attempt,
      kind: "check",
      at: ctx.now(),
      detail: { exits: exitsOf(t, unit, d.step) },
      running: true,
      log,
      timeout_ms: d.timeout_ms,
    };
    // recorded before the spawn, so a crash between the two leaves a record a replay finds
    await writeStepRun(ctx, base);
    return spawnInto(base);
  };
  const spawnInto = async (base: StepRunRecord): Promise<PluginResult<StepRunRecord>> => {
    const exitPath = checkExitPath(ctx, unit, d.run_id, d.attempt);
    const { running: _r, handle: _h, log: _l, timeout_ms: _t, ...rest } = base;
    const command = checkCommandOf(d.command, t.env.config.checks);
    let record: StepRunRecord;
    if (!command.ok) record = { ...rest, error: command.error };
    else
      try {
        const p = await procs.value.spawn(checkWrapperArgv(command.command, exitPath, wakePath(ctx)), { cwd: worktree.value, logPath: base.log as string });
        record = { ...base, handle: encodeCheckHandle(p.pid, p.started) };
      } catch (e) {
        record = { ...rest, error: `the check could not start: ${message(e)}` };
      }
    await writeStepRun(ctx, record);
    return ok(record);
  };
  const summary = (r: StepRunRecord, performed: boolean) =>
    ok({ performed, ...(r.running ? { running: true } : {}), ...(r.outcome !== undefined ? { outcome: r.outcome } : {}), ...(r.error !== undefined ? { error: r.error } : {}) });
  if (!intent) {
    const ran = await perform();
    return ran.ok ? summary(ran.value, true) : ran;
  }
  const acted = await t.env.journal.act(unit, { intent, perform, outcome: null, next: () => null });
  if (!acted.ok) return acted;
  const r = acted.value.value;
  if (!r) return ok({ performed: false });
  return summary(r, acted.value.performed && !reused);
}

export interface DetachedCheckRead {
  fact: StepRunFacts | undefined;
  /** the handle to stop: the check outlived its deadline */
  stop?: string;
  /**
   * the record as it now stands, when the read changed it (finished, timed out or died, or a start cut
   * short before its handle was recorded); facts write it
   */
  settled?: StepRunRecord;
}

function factOf(r: StepRunRecord): StepRunFacts {
  const fact: StepRunFacts = { kind: r.kind, running: r.running === true };
  if (r.outcome !== undefined) fact.outcome = r.outcome;
  if (r.error !== undefined) fact.error = r.error;
  return fact;
}

function recordedExits(r: StepRunRecord): Record<string, string> {
  const exits = (r.detail as { exits?: unknown } | undefined)?.exits;
  if (!exits || typeof exits !== "object") return {};
  return Object.fromEntries(Object.entries(exits).filter((e): e is [string, string] => typeof e[1] === "string"));
}

async function tail(ctx: HostContext, r: StepRunRecord): Promise<string> {
  const text = r.log ? await ctx.files.read(r.log) : null;
  return text ?? "";
}

function settle(r: StepRunRecord, over: Partial<StepRunRecord>): DetachedCheckRead {
  const { running: _running, ...rest } = r;
  const settled: StepRunRecord = { ...rest, ...over };
  return { fact: factOf(settled), settled };
}

async function finished(ctx: HostContext, r: StepRunRecord, text: string): Promise<DetachedCheckRead> {
  const parsed = parseJson(CheckExit, text, "check exit");
  const output = await tail(ctx, r);
  // an exit file that fails validation is not read as any exit: the check fails and says why
  if (!parsed.ok) return settle(r, { outcome: "fail", output: `${output}\n(the check's exit file is unreadable: ${parsed.failure.message})`.slice(-OUTPUT_TAIL), finished_at: ctx.now() });
  return settle(r, { outcome: checkOutcome(recordedExits(r), parsed.value.exit, false), exit: parsed.value.exit, output: output.slice(-OUTPUT_TAIL), finished_at: parsed.value.finished_at });
}

async function isAlive(ctx: HostContext, handle: string | undefined): Promise<boolean> {
  const h = handle ? decodeCheckHandle(handle) : null;
  if (!h) return false;
  // without a probe the run cannot be told dead; the deadline still ends it
  if (typeof ctx.alive !== "function") return true;
  return ctx.alive(h.pid, h.started);
}

/** How long a start recorded without a handle or pid file is taken as still starting, not cut short. */
export const CHECK_START_GRACE_MS = 30_000;

/** The step-run fact of a detached check at `now`, from its record, its exit file and its process. */
export async function readDetachedCheck(ctx: HostContext, recorded: StepRunRecord, now: string): Promise<DetachedCheckRead> {
  if (recorded.running !== true) return { fact: factOf(recorded) };
  let record = recorded;
  if (record.handle === undefined) {
    const found = await handleFromPidFile(ctx, record);
    if (found === null) {
      // a tick may be between recording the start and its wrapper leaving the pid file: until the grace
      // has passed the start is in flight, and settling it now would make decide spawn the check twice
      if (Date.parse(now) - Date.parse(record.at) <= CHECK_START_GRACE_MS) return { fact: factOf(record) };
      // no pid file long after the start: the spawn never ran, so the run reads cut short and decide runs it again
      const { running: _running, ...rest } = record;
      return { fact: factOf(rest), settled: rest };
    }
    record = { ...record, handle: found };
  }
  const read = await readRunning(ctx, record, now);
  return read.settled || record === recorded ? read : { ...read, settled: record };
}

/** The handle of the process a start cut short before recording it made, from the wrapper's pid file. */
async function handleFromPidFile(ctx: HostContext, r: StepRunRecord): Promise<string | null> {
  const pid = Number((await ctx.files.read(checkPidPath(ctx, r.unit, r.run_id, r.attempt)))?.trim());
  return Number.isInteger(pid) && pid > 0 ? encodeCheckHandle(pid, "") : null;
}

async function readRunning(ctx: HostContext, record: StepRunRecord, now: string): Promise<DetachedCheckRead> {
  const exitPath = checkExitPath(ctx, record.unit, record.run_id, record.attempt);
  const exitText = await ctx.files.read(exitPath);
  if (exitText !== null) return finished(ctx, record, exitText);
  const deadline = record.timeout_ms !== undefined ? Date.parse(record.at) + record.timeout_ms : Number.POSITIVE_INFINITY;
  const alive = await isAlive(ctx, record.handle);
  if (Date.parse(now) > deadline) {
    const read = settle(record, { outcome: "fail", output: `${await tail(ctx, record)}\n(timed out after ${record.timeout_ms} ms)`.slice(-OUTPUT_TAIL), finished_at: now });
    return alive && record.handle ? { ...read, stop: record.handle } : read;
  }
  if (alive) return { fact: factOf(record) };
  // it may have exited between the first read and the probe
  const late = await ctx.files.read(exitPath);
  if (late !== null) return finished(ctx, record, late);
  return settle(record, {
    outcome: "fail",
    error: "the check's process ended without recording its exit (killed, or the machine restarted)",
    output: (await tail(ctx, record)).slice(-OUTPUT_TAIL),
    finished_at: now,
  });
}

/** Between TERM to a check's group and KILL, while its leader lives on. */
export const CHECK_KILL_GRACE_MS = 2_000;
const STOP_POLL_MS = 100;

export interface StopDeps {
  /** waits between stop's looks; a test passes one that returns at once */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * End a detached check's process group: TERM, then KILL once the leader ends or outlives the grace,
 * as a test runner's workers may ignore TERM and outlive the wrapper; a group id is not handed out
 * again while any member lives, so the KILL reaches only what is left of the check. One already gone,
 * or a host that cannot kill, is nothing to do.
 */
export async function stopDetachedCheck(ctx: HostContext, handle: string, deps: StopDeps = {}): Promise<void> {
  const h = decodeCheckHandle(handle);
  if (!h || typeof ctx.kill !== "function") return;
  const probe = typeof ctx.alive === "function" ? ctx.alive.bind(ctx) : null;
  if (probe && !(await probe(h.pid, h.started))) return;
  await ctx.kill(h.pid, "TERM");
  const sleep = deps.sleep ?? realSleep;
  for (let waited = 0; probe && waited < CHECK_KILL_GRACE_MS; waited += STOP_POLL_MS) {
    await sleep(STOP_POLL_MS);
    if (!(await probe(h.pid, h.started))) break;
  }
  await ctx.kill(h.pid, "KILL");
}
