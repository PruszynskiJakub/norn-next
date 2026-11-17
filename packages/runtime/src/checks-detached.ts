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
 */
import type { DecisionOf, StepRunFacts } from "@norn/kernel";
import { fail, type HostContext, hostProcesses, ok, parseJson, type PluginResult } from "@norn/plugin-api";
import { IsoTime } from "@norn/schema";
import { type Static, Type } from "@sinclair/typebox";
import { ensureWorktree } from "./branches.ts";
import type { TickContext } from "./env.ts";
import { unitInFacts } from "./record.ts";
import { readStepRun, type StepRunRecord, writeStepRun } from "./step-runs.ts";

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

export function checkExitPath(ctx: HostContext, unit: string, runId: string, attempt: number): string {
  return `${ctx.repo.dataDir}/runtime/check-exits/${unit.replace("/", "-")}/${runId}-${attempt}.json`;
}

export function checkLogPath(ctx: HostContext, unit: string, runId: string, attempt: number): string {
  return `${ctx.repo.dataDir}/runtime/check-logs/${unit.replace("/", "-")}/${runId}-${attempt}.log`;
}

// the command and the exit path arrive as positional arguments, never spliced into the script, so
// no quoting in either can change what the wrapper runs
const WRAPPER = [
  'sh -c "$1"',
  "code=$?",
  'mkdir -p "$(dirname "$2")" || exit 1',
  `printf '{"exit":%d,"finished_at":"%s"}\\n' "$code" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$2.tmp" && mv -f "$2.tmp" "$2"`,
].join("\n");

/** The argv that runs `command` and writes the exit file once it exits. */
export function checkWrapperArgv(command: string, exitPath: string): string[] {
  return ["sh", "-c", WRAPPER, "norn-check", command, exitPath];
}

/** A detached check's handle: `<pid>@<start marker>`; the marker is opaque, so only the first `@` splits. */
export function encodeCheckHandle(pid: number, started: string): string {
  return `${pid}@${started}`;
}

export function decodeCheckHandle(handle: string): { pid: number; started: string } | null {
  const at = handle.indexOf("@");
  if (at < 1) return null;
  const pid = Number(handle.slice(0, at));
  if (!Number.isInteger(pid) || pid < 1) return null;
  return { pid, started: handle.slice(at + 1) };
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
    if (prior && intent && prior.intent_id === intent.id && (prior.running === true || prior.outcome !== undefined || prior.error !== undefined)) {
      reused = true;
      return ok(prior);
    }
    const exitPath = checkExitPath(ctx, unit, d.run_id, d.attempt);
    const log = checkLogPath(ctx, unit, d.run_id, d.attempt);
    // a rerun goes under the same run and attempt: what the cut-short run left must not read as this one's
    await ctx.files.remove(exitPath);
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
    };
    let record: StepRunRecord;
    try {
      const p = await procs.value.spawn(checkWrapperArgv(d.command, exitPath), { cwd: worktree.value, logPath: log });
      record = { ...base, running: true, handle: encodeCheckHandle(p.pid, p.started), log, timeout_ms: d.timeout_ms };
    } catch (e) {
      record = { ...base, error: `the check could not start: ${message(e)}` };
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
  /** the record as it now stands, when the read settled it (finished, timed out or died); facts write it */
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

/** The step-run fact of a detached check at `now`, from its record, its exit file and its process. */
export async function readDetachedCheck(ctx: HostContext, record: StepRunRecord, now: string): Promise<DetachedCheckRead> {
  if (record.running !== true) return { fact: factOf(record) };
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

/** End a detached check's process; one already gone, or a host that cannot kill, is nothing to do. */
export async function stopDetachedCheck(ctx: HostContext, handle: string): Promise<void> {
  const h = decodeCheckHandle(handle);
  if (h && typeof ctx.kill === "function" && (typeof ctx.alive !== "function" || (await ctx.alive(h.pid, h.started)))) await ctx.kill(h.pid);
}
