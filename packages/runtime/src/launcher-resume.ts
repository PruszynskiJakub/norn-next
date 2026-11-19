/**
 * Resuming a run whose headless session ended. A non-interactive agent (`claude -p`) exits once its
 * turn may end, so an answer or nudge queued for its next hook answer would wait for a hook that never
 * fires. Instead the launcher starts the harness again on the recorded harness session with the marked
 * text as the prompt, the way a person resumes it, and the run goes on in the same session.
 *
 * - the launch record (written at start) keeps what a relaunch needs that the handle does not carry;
 * - each resumed launch is recorded by its prompt id with the runner's handle, so a replayed delivery
 *   finds it rather than starting a second agent, and the newest one is the run's live process for
 *   `alive` and `stop`;
 * - the relaunch appends a `session.started` for the resumed session: the tick that applies the
 *   answer must not read the old end as a death before the new process's own hooks have run.
 */
import { reduceSession } from "@norn/kernel";
import type { Harness, HostContext, PluginResult, Runner } from "@norn/plugin-api";
import { fail, ok, parseJson, RUN_ENV } from "@norn/plugin-api";
import { IsoTime, NonEmpty } from "@norn/schema";
import { Type } from "@sinclair/typebox";
import { appendEvents, readEvents } from "./events/log.ts";
import { launchRecordPath, resumesDir } from "./events/paths.ts";
import type { LaunchHandle } from "./launcher-handle.ts";

const LaunchRecord = Type.Object(
  {
    executor: NonEmpty,
    cwd: NonEmpty,
    title: Type.String(),
    workspace: Type.String(),
    logPath: NonEmpty,
    /** a resume asks for the model the run started on, as a harness may otherwise resume on its default */
    model: Type.Optional(NonEmpty),
  },
  { additionalProperties: false, title: "LaunchRecord" },
);
type LaunchRecord = typeof LaunchRecord.static;

const ResumeRecord = Type.Object({ id: NonEmpty, handle: NonEmpty, at: IsoTime }, { additionalProperties: false, title: "ResumeRecord" });
type ResumeRecord = typeof ResumeRecord.static;

const json = (value: unknown): string => `${JSON.stringify(value)}\n`;
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Kept once: a replayed start launches the same run, so the first record stands. */
export async function recordLaunch(ctx: HostContext, unit: string, runId: string, rec: LaunchRecord): Promise<PluginResult<void>> {
  try {
    await ctx.files.create(launchRecordPath(ctx, unit, runId), json(rec));
    return ok(undefined);
  } catch (e) {
    return fail("unavailable", `recording the launch of ${unit} run ${runId}: ${message(e)}`);
  }
}

/**
 * Whether this machine launched the run. A runner's handle (a pane id) is only unique on the machine
 * that made it, so a run launched elsewhere is never probed or sent keys through it here.
 */
export async function launchedHere(ctx: HostContext, unit: string, runId: string): Promise<boolean> {
  return (await ctx.files.read(launchRecordPath(ctx, unit, runId))) !== null;
}

export async function readLaunch(ctx: HostContext, unit: string, runId: string): Promise<PluginResult<LaunchRecord>> {
  const path = launchRecordPath(ctx, unit, runId);
  const text = await ctx.files.read(path);
  if (text === null) return fail("not_found", `${unit} run ${runId} has no launch record at ${path}`, false);
  return parseJson(LaunchRecord, text, path);
}

/** Every resumed launch of the run, oldest first; a record that fails validation is skipped, never guessed. */
export async function resumesOf(ctx: HostContext, unit: string, runId: string): Promise<ResumeRecord[]> {
  const dir = resumesDir(ctx, unit, runId);
  const out: ResumeRecord[] = [];
  for (const name of await ctx.files.list(dir)) {
    if (!name.endsWith(".json")) continue;
    const text = await ctx.files.read(`${dir}/${name}`);
    if (text === null) continue;
    const parsed = parseJson(ResumeRecord, text, `${dir}/${name}`);
    if (parsed.ok) out.push(parsed.value);
  }
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
}

/** The runner handle of the run's newest process: its latest resume, else the first launch. */
export async function currentRunnerHandle(ctx: HostContext, h: LaunchHandle): Promise<string> {
  return (await resumesOf(ctx, h.unit, h.run_id)).at(-1)?.handle ?? h.runner;
}

// a runner key becomes a file name in some runners, so it keeps to a filename-safe charset
export const keyOf = (runId: string, promptId: string): string => `${runId}.${promptId.replace(/[^A-Za-z0-9_-]/g, "_")}`;

export interface ResumeInput {
  ctx: HostContext;
  handle: LaunchHandle;
  harness: Harness;
  runner: Runner;
  /** the prompt id the text goes under */
  id: string;
  /** already marked */
  text: string;
  /** what the launch adds to the agent's env beside the run's own (agent-bin.ts's PATH) */
  env?: Record<string, string>;
  /** the executor's extra arguments, as the first launch had them */
  args?: readonly string[];
  /** run in the launch's folder before the relaunch: what the session needs there that a clean of the worktree took (its hooks) */
  prepare?(cwd: string): Promise<PluginResult<void>>;
}

/**
 * Relaunch the run's ended session with `text` as its prompt. Refused, so the caller does not count
 * the text as delivered, when the harness cannot resume or no session to resume was ever reported.
 */
export async function resumeWith(input: ResumeInput): Promise<PluginResult<void>> {
  const { ctx, handle: h, harness, runner, id, text } = input;
  const what = `${h.unit} run ${h.run_id}`;
  const recordPath = `${resumesDir(ctx, h.unit, h.run_id)}/${id}.json`;
  if ((await ctx.files.read(recordPath)) !== null) return ok(undefined);
  if (harness.capabilities.resume !== true)
    return fail("unavailable", `${what}: its session has ended and ${harness.name} cannot resume one, so the text would reach no agent`, false);
  const log = await readEvents(ctx, h.unit, h.run_id);
  const session = reduceSession(log.events).harness_session;
  if (session === undefined) return fail("unavailable", `${what}: its session has ended and never reported a harness session to resume`, false);
  const launch = await readLaunch(ctx, h.unit, h.run_id);
  if (!launch.ok) return launch;
  if (input.prepare) {
    const prepared = await input.prepare(launch.value.cwd);
    if (!prepared.ok) return prepared;
  }
  const env = { ...input.env, [RUN_ENV.unit]: h.unit, [RUN_ENV.run]: h.run_id };
  let spec: ReturnType<Harness["launch"]>;
  try {
    const model = launch.value.model;
    spec = harness.launch({
      cwd: launch.value.cwd,
      prompt: text,
      run_id: h.run_id,
      env: { ...env },
      resume: session,
      headless: true,
      ...(model !== undefined ? { model } : {}),
      ...(input.args !== undefined ? { args: [...input.args] } : {}),
    });
  } catch (e) {
    return fail("invalid", `${harness.name}: resume could not be built: ${message(e)}`, false);
  }
  const started = await runner.start({
    key: keyOf(h.run_id, id),
    argv: spec.argv,
    env: { ...spec.env, ...env },
    cwd: launch.value.cwd,
    title: launch.value.title,
    workspace: launch.value.workspace,
    logPath: launch.value.logPath,
  });
  if (!started.ok) return started;
  const at = ctx.now();
  try {
    await ctx.files.create(recordPath, json({ id, handle: started.value.handle, at }));
  } catch (e) {
    return fail("unavailable", `${what}: recording the resumed launch: ${message(e)}`);
  }
  const appended = await appendEvents(ctx, h.unit, h.run_id, [{ type: "session.started", run_id: h.run_id, seq: 0, at, harness_session: session }]);
  return appended.ok ? ok(undefined) : appended;
}
