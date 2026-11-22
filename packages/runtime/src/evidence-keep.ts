/**
 * Keeping a QA report's evidence: the files the run wrote to `$NORN_OUT/evidence/`, compressed, as one
 * commit on the story's evidence ref, which the report's receipt names. The commit is written before
 * the receipt and the ref moved after it: a commit no receipt names is garbage, never a record.
 */
import type { KeptFile } from "@norn/plugin-api";
import { parseUnitId } from "@norn/plugin-api";
import { type KeptEvidenceFile, REPORT_TYPES, type ReportEvidence } from "@norn/schema";
import type { RuntimeEnv } from "./env.ts";
import { compressEvidence } from "./evidence-compress.ts";
import { EVIDENCE_COPIES_DIR, OUT_DIR, worktreeOf } from "./inputs.ts";

/** The ref a story's evidence commits are kept on: norn's own, never a branch. */
export function evidenceRef(unit: string): string {
  return `refs/norn/evidence/${parseUnitId(unit)?.story ?? unit}`;
}

/** Where the agent writes its evidence, relative to the worktree. */
const EVIDENCE_OUT = `${OUT_DIR}/${REPORT_TYPES.evidence.path.replace(/\/$/, "")}`;

const MB = 1024 * 1024;
/** A file still over this once compressed is left out: the remote and the reviewer's page stay small. */
export const EVIDENCE_MAX_BYTES = 10 * MB;

export interface KeptEvidence {
  /** absent when no file was kept */
  evidence?: ReportEvidence;
  /** a line for `norn done`'s output per file left out or kept uncompressed for a reason */
  notes: string[];
}

export type KeepResult = { ok: true; value: KeptEvidence } | { ok: false; error: string; code: string };

/**
 * Whether this report keeps evidence: a run whose step produces criteria, a repo that publishes it, a
 * vcs that keeps files and a forge that serves a commit's files. Otherwise the report is as it always was.
 */
export function keepsEvidence(env: RuntimeEnv, producesCriteria: boolean): boolean {
  const { vcs, forge } = env.slots;
  const files = env.ctx.files;
  return (
    producesCriteria &&
    env.config.evidencePublish !== false &&
    forge.capabilities.raw_urls &&
    vcs.keepFiles !== undefined &&
    vcs.moveRef !== undefined &&
    files.readBytes !== undefined &&
    files.writeBytes !== undefined
  );
}

/**
 * Compress the run's evidence files and write them as one commit, parented on the ref; the ref is not
 * moved. Files are read now, so the report that goes through keeps the folder as it is at that moment.
 */
export async function keepEvidence(env: RuntimeEnv, unit: string, runId: string): Promise<KeepResult> {
  const files = env.ctx.files;
  const keepFiles = env.slots.vcs.keepFiles;
  if (!files.readBytes || !files.writeBytes || !keepFiles) return { ok: true, value: { notes: [] } };
  const worktree = worktreeOf(env, unit);
  const out = `${worktree}/${EVIDENCE_OUT}`;
  const copies = `${worktree}/${EVIDENCE_COPIES_DIR}`;
  // copies a keep that failed left behind are not this report's
  for (const old of await files.list(copies)) await files.remove(`${copies}/${old}`);
  const names = await files.list(out);
  const taken = new Set(names);
  const notes: string[] = [];
  const kept: (KeptEvidenceFile & KeptFile)[] = [];
  for (const name of names) {
    const path = `${out}/${name}`;
    // a link would publish whatever it points at, inside the repo or not
    if (files.readLink && (await files.readLink(path)) !== null) continue;
    let bytes: Uint8Array | null;
    try {
      bytes = await files.readBytes(path);
    } catch {
      // a folder is no file to keep
      bytes = null;
    }
    if (bytes === null) continue;
    const c = await compressEvidence(bytes, name);
    if (c.message !== undefined) notes.push(c.message);
    if (c.bytes.length > EVIDENCE_MAX_BYTES) {
      notes.push(`${name} not kept: ${(c.bytes.length / MB).toFixed(1)} MB is over the ${EVIDENCE_MAX_BYTES / MB} MB limit`);
      continue;
    }
    if (c.name === name) {
      kept.push({ name, kept: name, path: name, at: path });
      continue;
    }
    const as = taken.has(c.name) ? `${name}.webp` : c.name;
    taken.add(as);
    await files.writeBytes(`${copies}/${as}`, c.bytes);
    kept.push({ name, kept: as, path: as, at: `${copies}/${as}` });
  }
  if (kept.length === 0) return { ok: true, value: { notes } };
  const made = await keepFiles(
    evidenceRef(unit),
    kept.map(({ path, at }) => ({ path, at })),
    `Evidence of ${unit}, run ${runId}`,
  );
  if (!made.ok) return { ok: false, error: `cannot keep the evidence of ${unit}: ${made.failure.message}`, code: made.failure.code };
  return { ok: true, value: { evidence: { commit: made.value.commit, files: kept.map(({ name, kept }) => ({ name, kept })) }, notes } };
}

/**
 * Move the evidence ref to the commit a written receipt names: safe to repeat, as a ref already there
 * stays. A line for `norn done`'s output when it could not, null when it moved or was there.
 */
export async function moveEvidenceRef(env: RuntimeEnv, unit: string, evidence: ReportEvidence): Promise<string | null> {
  const moveRef = env.slots.vcs.moveRef;
  if (!moveRef) return null;
  const r = await moveRef(evidenceRef(unit), evidence.commit);
  if (r.ok) return null;
  return `evidence commit ${evidence.commit.slice(0, 12)} is recorded, but ${evidenceRef(unit)} was not moved to it: ${r.failure.message}; report again with the same command to move it`;
}
