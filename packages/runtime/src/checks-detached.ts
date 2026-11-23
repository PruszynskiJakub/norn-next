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
import { checkCommandOf } from "./check-command.ts";
import { untrackedFiles } from "./check-leftovers.ts";
import { type DetachedRead, encodeCheckHandle, handleFromPidFile, readDetached, type StopDeps, stopDetached } from "./detached.ts";
import type { TickContext } from "./env.ts";
import { unitInFacts } from "./record.ts";
import { prepareWorktree } from "./setup.ts";
import { readStepRun, type StepRunRecord, writeStepRun } from "./step-runs.ts";
import { CHECK_WAKE_WRITER, wakePath } from "./wake.ts";

export { CHECK_KILL_GRACE_MS, CHECK_START_GRACE_MS, decodeCheckHandle, encodeCheckHandle, type StopDeps } from "./detached.ts";

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
  const prepared = await prepareWorktree(t, unit);
  if (!prepared.ok) return prepared;
  // before the intent: a check that waits on its worktree's setup spends no retry and writes nothing
  if (prepared.value.waiting) return ok({ performed: false, waiting: prepared.value.waiting });
  const worktree = prepared.value.path;
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
      const handle = await handleFromPidFile(ctx, checkPidPath(ctx, unit, d.run_id, d.attempt));
      if (handle !== null) {
        reused = true;
        const found: StepRunRecord = { ...prior, handle };
        await writeStepRun(ctx, found);
        return ok(found);
      }
      return spawnInto(prior);
    }
    const log = checkLogPath(ctx, unit, d.run_id, d.attempt);
    const before = await untrackedFiles(t.env, worktree);
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
      ...(before !== null && { untracked_before: before }),
    };
    // recorded before the spawn, so a crash between the two leaves a record a replay finds
    await writeStepRun(ctx, base);
    return spawnInto(base);
  };
  const spawnInto = async (base: StepRunRecord): Promise<PluginResult<StepRunRecord>> => {
    const exitPath = checkExitPath(ctx, unit, d.run_id, d.attempt);
    const { running: _r, handle: _h, log: _l, timeout_ms: _t, untracked_before: _u, ...rest } = base;
    const command = checkCommandOf(d.command, t.env.config.checks);
    let record: StepRunRecord;
    if (!command.ok) record = { ...rest, error: command.error };
    else
      try {
        const p = await procs.value.spawn(checkWrapperArgv(command.command, exitPath, wakePath(ctx)), { cwd: worktree, logPath: base.log as string });
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

/** The step-run fact of a detached check at `now`, from its record, its exit file and its process. */
export async function readDetachedCheck(ctx: HostContext, recorded: StepRunRecord, now: string): Promise<DetachedCheckRead> {
  if (recorded.running !== true) return { fact: factOf(recorded) };
  const read = await readDetached(
    ctx,
    {
      ...(recorded.handle !== undefined && { handle: recorded.handle }),
      at: recorded.at,
      ...(recorded.timeout_ms !== undefined && { timeoutMs: recorded.timeout_ms }),
      exitPath: checkExitPath(ctx, recorded.unit, recorded.run_id, recorded.attempt),
      pidPath: checkPidPath(ctx, recorded.unit, recorded.run_id, recorded.attempt),
    },
    now,
  );
  if (read.kind === "starting") return { fact: factOf(recorded) };
  if (read.kind === "never_started") {
    // no pid file long after the start: the spawn never ran, so the run reads cut short and decide runs it again
    const { running: _running, ...rest } = recorded;
    return { fact: factOf(rest), settled: rest };
  }
  const record = read.handle === recorded.handle ? recorded : { ...recorded, handle: read.handle };
  const out = await settleRead(ctx, record, read, now);
  return out.settled || record === recorded ? out : { ...out, settled: record };
}

async function settleRead(ctx: HostContext, record: StepRunRecord, read: Exclude<DetachedRead, { kind: "starting" | "never_started" }>, now: string): Promise<DetachedCheckRead> {
  switch (read.kind) {
    case "exited":
      return finished(ctx, record, read.exitText);
    case "timed_out": {
      const settled = settle(record, { outcome: "fail", output: `${await tail(ctx, record)}\n(timed out after ${record.timeout_ms} ms)`.slice(-OUTPUT_TAIL), finished_at: now });
      return read.alive ? { ...settled, stop: read.handle } : settled;
    }
    case "running":
      return { fact: factOf(record) };
    case "died":
      return settle(record, {
        outcome: "fail",
        error: "the check's process ended without recording its exit (killed, or the machine restarted)",
        output: (await tail(ctx, record)).slice(-OUTPUT_TAIL),
        finished_at: now,
      });
  }
}

/** End a detached check's process group (detached.ts). */
export async function stopDetachedCheck(ctx: HostContext, handle: string, deps: StopDeps = {}): Promise<void> {
  return stopDetached(ctx, handle, deps);
}
