/**
 * What norn keeps on the machine and for how long: tick traces age out by `trace.retain`, and a
 * finished story's logs go with its worktrees. Both run inside the tick, so nobody has to remember a
 * command, and both are only disk: a file that cannot be removed is a problem in the tick report,
 * never a failed tick or a finish carried out again.
 */
import type { HostContext } from "@norn/plugin-api";
import { isUlid, ulidTime } from "@norn/schema";
import { checkExitsDir, checkLogsDir } from "./checks-detached.ts";
import type { RuntimeEnv } from "./env.ts";
import { RUN_EVENT_FOLDERS, unitEventsDir } from "./events/paths.ts";
import { sessionLogPath } from "./launcher.ts";
import { dropSetupRecord, setupRecordPath } from "./setup-record.ts";
import { TRACE_DIR } from "./trace.ts";

export const DEFAULT_TRACE_RETAIN_MS = 7 * 24 * 3_600_000;

/** At most this many traces go per tick, so a backlog of months drains over several ticks and never makes one slow. */
export const TRACE_PRUNE_PER_TICK = 200;

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const TRACE_NAME = /^([0-9A-HJKMNP-TV-Z]{26})\.json$/;

/** Collects removal failures, naming the first and counting the rest, so one bad folder never floods the report. */
class Failures {
  private first: string | null = null;
  private count = 0;
  constructor(private readonly what: string) {}
  add(path: string, e: unknown): void {
    if (this.first === null) this.first = `${path}: ${message(e)}`;
    this.count++;
  }
  problem(): string | null {
    if (this.first === null) return null;
    return `${this.what}: ${this.count} file${this.count === 1 ? "" : "s"} could not be removed; first: ${this.first}`;
  }
}

/**
 * Remove the traces older than `retainMs`, measured from the tick's own id rather than the clock: a
 * tick id's time part is the clock it ran by, so the two agree, and age is read off the names with
 * no stat. A name that is not a tick id is someone else's and stays. `null` keeps every trace.
 */
export async function pruneTraces(ctx: HostContext, tickId: string, retainMs: number | null, limit = TRACE_PRUNE_PER_TICK): Promise<string[]> {
  if (retainMs === null || !isUlid(tickId)) return [];
  const cutoff = ulidTime(tickId) - retainMs;
  const dir = `${ctx.repo.dataDir}/${TRACE_DIR}`;
  let names: string[];
  try {
    names = await ctx.files.list(dir);
  } catch (e) {
    return [`trace retention: ${dir} could not be listed: ${message(e)}`];
  }
  const failures = new Failures("trace retention");
  let removed = 0;
  // a ULID's time part leads it, so the sorted listing is oldest first and the first young trace ends the walk
  for (const name of names) {
    if (removed >= limit) break;
    const id = TRACE_NAME.exec(name)?.[1];
    if (!id) continue;
    if (ulidTime(id) >= cutoff) break;
    const path = `${dir}/${name}`;
    try {
      await ctx.files.remove(path);
    } catch (e) {
      failures.add(path, e);
    }
    removed++;
  }
  const problem = failures.problem();
  return problem ? [problem] : [];
}

async function removeAll(ctx: HostContext, paths: readonly string[], failures: Failures): Promise<number> {
  let n = 0;
  for (const path of paths) {
    try {
      await ctx.files.remove(path);
      n++;
    } catch (e) {
      failures.add(path, e);
    }
  }
  return n;
}

/** The files a run's hook folder holds, a level deep as its layout has them; the folders stay, as the host removes only files. */
async function runEventFiles(ctx: HostContext, runDir: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of await ctx.files.list(runDir)) {
    const path = `${runDir}/${name}`;
    if (RUN_EVENT_FOLDERS.includes(name)) out.push(...(await ctx.files.list(path)).map((f) => `${path}/${f}`));
    else out.push(path);
  }
  return out;
}

/** The files under `dir` whose names start with one of the runs, as check logs and exits are keyed. */
async function filesOfRuns(ctx: HostContext, dir: string, runs: ReadonlySet<string>): Promise<string[]> {
  return (await ctx.files.list(dir)).filter((name) => [...runs].some((r) => name.startsWith(`${r}-`))).map((name) => `${dir}/${name}`);
}

/**
 * A finished unit's logs: its hook event folders, the session and check logs of every run its record
 * started, and its worktree's setup record and log. Called once its worktree is gone, so nothing is
 * still writing them.
 */
export async function removeUnitLogs(env: RuntimeEnv, unit: string): Promise<{ removed: number; problems: string[] }> {
  const { ctx } = env;
  const failures = new Failures(`${unit}: logs`);
  const problems: string[] = [];
  const read = await env.journal.readUnit(unit);
  const runs = new Set<string>();
  if (read.ok) {
    for (const r of read.value.receipts) if (r.data.kind === "run.started") runs.add(r.data.run_id);
  } else {
    problems.push(`${unit}: logs: its record could not be read, so its session and check logs stay: ${read.failure.message}`);
  }
  const paths: string[] = [];
  try {
    const eventsDir = unitEventsDir(ctx, unit);
    for (const run of await ctx.files.list(eventsDir)) paths.push(...(await runEventFiles(ctx, `${eventsDir}/${run}`)));
    for (const run of runs) paths.push(sessionLogPath(ctx, run));
    if (runs.size > 0) paths.push(...(await filesOfRuns(ctx, checkLogsDir(ctx, unit), runs)), ...(await filesOfRuns(ctx, checkExitsDir(ctx, unit), runs)));
  } catch (e) {
    problems.push(`${unit}: logs could not be listed: ${message(e)}`);
  }
  const removed = await removeAll(ctx, paths, failures);
  try {
    await dropSetupRecord(ctx, unit);
  } catch (e) {
    failures.add(setupRecordPath(ctx, unit), e);
  }
  const problem = failures.problem();
  if (problem) problems.push(problem);
  return { removed, problems };
}
