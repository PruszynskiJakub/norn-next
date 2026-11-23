/**
 * What this machine remembers of a unit worktree's setup (setup.ts): one record per unit in the machine
 * dir, beside the step runs, and the setup's log, exit and pid files in a folder named after it. It is
 * only a cache of work done on this machine's disk: a record that fails validation is removed and read
 * as none, so the setup runs again, and never makes the unit corrupt.
 */
import { type HostContext, parseJson } from "@norn/plugin-api";
import { IsoTime, NonEmpty, PosInt, ULID_PATTERN } from "@norn/schema";
import { type Static, Type } from "@sinclair/typebox";
import { stopDetached } from "./detached.ts";

export const SETUP_DIR = "runtime/setup";

export const SetupRecord = Type.Object(
  {
    unit: NonEmpty,
    id: Type.String({ pattern: ULID_PATTERN }),
    command: NonEmpty,
    /** the digest of the command and the inputs: as they were at the start, and once it succeeded as they are after it */
    digest: NonEmpty,
    inputs: Type.Array(Type.String()),
    worktree: NonEmpty,
    state: Type.Union([Type.Literal("running"), Type.Literal("done"), Type.Literal("failed")]),
    started_at: IsoTime,
    timeout_ms: PosInt,
    log: NonEmpty,
    /** the detached process, as detached.ts encodes it; absent until the spawn answered, and for a setup run inside the tick */
    handle: Type.Optional(NonEmpty),
    finished_at: Type.Optional(IsoTime),
    exit: Type.Optional(Type.Integer()),
    /** why a failed setup failed, as the park says it: `exited 1`, `timed out after 15m` */
    reason: Type.Optional(NonEmpty),
    /** the end of what the setup printed */
    output: Type.Optional(Type.String()),
  },
  { additionalProperties: false, title: "SetupRecord" },
);
export type SetupRecord = Static<typeof SetupRecord>;

const dashed = (unit: string): string => unit.replace("/", "-");

export const setupRecordPath = (ctx: HostContext, unit: string): string => `${ctx.repo.dataDir}/${SETUP_DIR}/${dashed(unit)}.json`;
export const setupFilesDir = (ctx: HostContext, unit: string): string => `${ctx.repo.dataDir}/${SETUP_DIR}/${dashed(unit)}`;
export const setupLogPath = (ctx: HostContext, unit: string, id: string): string => `${setupFilesDir(ctx, unit)}/${id}.log`;
export const setupExitPath = (ctx: HostContext, unit: string, id: string): string => `${setupFilesDir(ctx, unit)}/${id}.json`;
/** the wrapper leaves its pid beside the exit file (checks-detached.ts) */
export const setupPidPath = (ctx: HostContext, unit: string, id: string): string => `${setupExitPath(ctx, unit, id)}.pid`;

/** The unit's setup record, or null when there is none; one that fails validation is removed. */
export async function readSetupRecord(ctx: HostContext, unit: string): Promise<SetupRecord | null> {
  const path = setupRecordPath(ctx, unit);
  const text = await ctx.files.read(path);
  if (text === null) return null;
  const parsed = parseJson(SetupRecord, text, "setup record");
  if (parsed.ok && parsed.value.unit === unit) return parsed.value;
  await ctx.files.remove(path);
  return null;
}

export async function writeSetupRecord(ctx: HostContext, record: SetupRecord): Promise<void> {
  await ctx.files.write(setupRecordPath(ctx, record.unit), `${JSON.stringify(record, null, 2)}\n`);
}

/**
 * Forget the unit's setup: stop one still running, then remove its record and its files. Called when
 * its worktree is made again or goes, so a worktree made again is always set up again.
 */
export async function dropSetupRecord(ctx: HostContext, unit: string): Promise<void> {
  const path = setupRecordPath(ctx, unit);
  const text = await ctx.files.read(path);
  const parsed = text === null ? null : parseJson(SetupRecord, text, "setup record");
  if (parsed?.ok && parsed.value.state === "running" && parsed.value.handle) await stopDetached(ctx, parsed.value.handle);
  const dir = setupFilesDir(ctx, unit);
  for (const name of await ctx.files.list(dir)) await ctx.files.remove(`${dir}/${name}`);
  await ctx.files.remove(path);
}
