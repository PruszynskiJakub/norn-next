/**
 * Where a run's hook traffic lives: `<dataDir>/events-v2/<unit>/<run>/`, outside every worktree.
 * - `events/<first seq>.json`  one batch of normalized events per hook call, named by its first seq
 * - `sent/<prompt id>.json`    every prompt the host sent the run, recorded before it was sent
 * - `received/<prompt id>`     a sent prompt seen arriving; made once, so a replayed mark is a person's
 * - `outbox/<id>.json`         text queued for the next hook answer when the runner has no pane
 * - `delivered/<id>`           an outbox entry a hook answer carried
 * - `stop-blocks/<n>`          one turn end refused for want of a report; made once each, so the cap holds across hooks
 * - `launch.json`              how the run was launched, so a session that ended can be resumed
 * - `resumes/<prompt id>.json` the runner handle of each resumed launch, the newest the run's live process
 * A slice's `/` becomes `-`, as step runs spell it: a story key never ends in `-<digits>-<digits>`.
 */
import type { HostContext } from "@norn/plugin-api";

export const EVENTS_DIR = "events-v2";

/** The folders a run's hook folder holds; everything else in it is a file. */
export const RUN_EVENT_FOLDERS: readonly string[] = ["events", "sent", "received", "outbox", "delivered", "stop-blocks", "resumes"];

const unitSegment = (unit: string): string => unit.replace("/", "-");

export const unitEventsDir = (ctx: HostContext, unit: string): string => `${ctx.repo.dataDir}/${EVENTS_DIR}/${unitSegment(unit)}`;

export function runEventsDir(ctx: HostContext, unit: string, runId: string): string {
  return `${unitEventsDir(ctx, unit)}/${runId}`;
}

export const batchesDir = (ctx: HostContext, unit: string, runId: string): string => `${runEventsDir(ctx, unit, runId)}/events`;
export const sentDir = (ctx: HostContext, unit: string, runId: string): string => `${runEventsDir(ctx, unit, runId)}/sent`;
export const receivedDir = (ctx: HostContext, unit: string, runId: string): string => `${runEventsDir(ctx, unit, runId)}/received`;
export const outboxDir = (ctx: HostContext, unit: string, runId: string): string => `${runEventsDir(ctx, unit, runId)}/outbox`;
export const deliveredDir = (ctx: HostContext, unit: string, runId: string): string => `${runEventsDir(ctx, unit, runId)}/delivered`;
export const stopBlocksDir = (ctx: HostContext, unit: string, runId: string): string => `${runEventsDir(ctx, unit, runId)}/stop-blocks`;
export const launchRecordPath = (ctx: HostContext, unit: string, runId: string): string => `${runEventsDir(ctx, unit, runId)}/launch.json`;
export const resumesDir = (ctx: HostContext, unit: string, runId: string): string => `${runEventsDir(ctx, unit, runId)}/resumes`;

/** Zero-padded, so the folder's sorted listing is seq order. */
export function batchName(firstSeq: number): string {
  return `${String(firstSeq).padStart(12, "0")}.json`;
}

/** The first seq a batch file's name holds, or null for a name no batch has. */
export function batchSeq(name: string): number | null {
  const m = /^(\d{12})\.json$/.exec(name);
  return m ? Number(m[1]) : null;
}
