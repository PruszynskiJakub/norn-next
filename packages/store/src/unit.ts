/**
 * One unit's `runs/<unit>/` folder: state.json (the commit point), the pinned
 * workflow, logs, evidence and handoff.md.
 */
import { mkdirSync } from "node:fs";
import type { UnitState, Workflow } from "@norn/schema";
import { assertValid } from "@norn/schema";
import { parse as parseYaml } from "yaml";
import { atomicCopyDir, atomicWrite, createExclusive, fileError, jsonLine, readJsonFile, readText, type ReadResult, validated } from "./fsx.ts";
import { evidenceDir, logPath, pinnedWorkflowPath, statePath } from "./paths.ts";

export function readState(unitDir: string, root?: string): ReadResult<UnitState> {
  return readJsonFile("state", statePath(unitDir), root);
}

/** Validate and atomically write state.json. Callers write it last. */
export function writeState(unitDir: string, state: UnitState): void {
  assertValid("state", state);
  atomicWrite(statePath(unitDir), jsonLine(state));
}

export function sha256(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

/** Parse workflow text (YAML or JSON — JSON is valid YAML) and validate it. */
export function parseWorkflowText(text: string, path: string, root?: string): ReadResult<Workflow> {
  let value: unknown;
  try {
    value = parseYaml(text);
  } catch (e) {
    return { ok: false, reason: "corrupt", error: fileError(path, [{ path: "", message: `YAML: ${(e as Error).message}` }], root) };
  }
  // The step-level keys that belong to the workflow get their own message
  const misplaced = workflowLevelKeysOnSteps(value);
  if (misplaced.length) return { ok: false, reason: "corrupt", error: fileError(path, misplaced, root) };
  return validated("workflow", value, path, text, root);
}

const WORKFLOW_LEVEL: Record<string, string> = {
  mode: "`mode` is set on the workflow, not on a step",
  stalled: "`stalled` is set in the workflow's `defaults:`, not on a step",
};

function workflowLevelKeysOnSteps(value: unknown): Array<{ path: string; message: string }> {
  const steps = (value as { steps?: unknown } | null)?.steps;
  if (typeof steps !== "object" || steps === null) return [];
  const out: Array<{ path: string; message: string }> = [];
  for (const [name, step] of Object.entries(steps))
    if (typeof step === "object" && step !== null) for (const k of Object.keys(WORKFLOW_LEVEL)) if (k in step) out.push({ path: `/steps/${name}/${k}`, message: WORKFLOW_LEVEL[k] as string });
  return out;
}

export interface PinnedWorkflow {
  workflow: Workflow;
  /** sha256 of the file text (state.workflow_hash) */
  hash: string;
  source: string;
}

export function readPinnedWorkflow(unitDir: string, root?: string): ReadResult<PinnedWorkflow> {
  const path = pinnedWorkflowPath(unitDir);
  const raw = readText(path);
  if (raw === null) return { ok: false, reason: "missing" };
  const r = parseWorkflowText(raw, path, root);
  return r.ok ? { ok: true, raw, value: { workflow: r.value, hash: sha256(raw), source: raw } } : r;
}

/**
 * Copy the workflow text verbatim to `runs/<unit>/workflow.yaml` at unit start.
 * Exclusive: an existing pin with identical text is fine (replay); a different one is
 * refused unless `replace` (the journaled `norn story edit --workflow --at` switch). Returns the hash.
 */
export function pinWorkflow(
  unitDir: string,
  source: string,
  opts: { replace?: boolean } = {},
): { ok: true; hash: string } | { ok: false; reason: "pinned"; hash: string } {
  const path = pinnedWorkflowPath(unitDir);
  const parsed = parseWorkflowText(source, path);
  if (!parsed.ok) throw new Error(`refusing to pin an invalid workflow: ${JSON.stringify(parsed.reason === "corrupt" ? parsed.error.errors : parsed.reason)}`);
  const hash = sha256(source);
  if (opts.replace) {
    atomicWrite(path, source);
    return { ok: true, hash };
  }
  if (createExclusive(path, source)) return { ok: true, hash };
  const existing = sha256(readText(path) ?? "");
  return existing === hash ? { ok: true, hash } : { ok: false, reason: "pinned", hash: existing };
}

/** Write the full output of a run to `logs/<run_id>.log`; returns the unit-relative path. */
export function writeLog(unitDir: string, runId: string, text: string): string {
  atomicWrite(logPath(unitDir, runId), text);
  return `logs/${runId}.log`;
}

export function readLog(unitDir: string, runId: string): string | null {
  return readText(logPath(unitDir, runId));
}

/**
 * Create (if needed) `evidence/<run_id>/`; optionally copy a directory into it. The copy lands via
 * temp + rename, so the evidence a `done` receipt names is never half-copied.
 * Returns the unit-relative path.
 */
export function ensureEvidenceDir(unitDir: string, runId: string, copyFrom?: string): string {
  const dir = evidenceDir(unitDir, runId);
  if (copyFrom) atomicCopyDir(copyFrom, dir);
  else mkdirSync(dir, { recursive: true });
  return `evidence/${runId}`;
}

/** The generated blocks an older norn kept at the top of a handoff (a header and heartbeat lines); norn writes neither any more. */
export const HANDOFF_HEADER_BEGIN = "<!-- norn:header:begin — generated by norn from state.json; do not edit -->";
export const HANDOFF_HEADER_END = "<!-- norn:header:end -->";
export const HANDOFF_LOG_BEGIN = "<!-- norn:heartbeat:begin — written by norn; do not edit -->";
export const HANDOFF_LOG_END = "<!-- norn:heartbeat:end -->";
const HANDOFF_SKELETON = "## Goal\n\n## Progress\n\n## Resume\n";

export interface Handoff {
  /** an older norn's generated header between its markers (no markers); "" when the file has none */
  header: string;
  /** an older norn's heartbeat lines, oldest first; [] when the file has none */
  heartbeat: string[];
  /** the agent/human-written part below any generated blocks, verbatim */
  body: string;
  raw: string;
}

function cutBlock(text: string, begin: string, end: string): { inner: string; rest: string } | null {
  const b = text.indexOf(begin);
  if (b !== 0) return null;
  const e = text.indexOf(end, b + begin.length);
  if (e < 0) return null;
  const inner = text.slice(b + begin.length, e).replace(/^\n/, "").replace(/\n$/, "");
  let rest = text.slice(e + end.length);
  if (rest.startsWith("\n")) rest = rest.slice(1);
  return { inner, rest };
}

/** Parse a handoff. A file without norn blocks is all body (an agent's own text is never lost). */
export function parseHandoff(raw: string): Handoff {
  const head = cutBlock(raw, HANDOFF_HEADER_BEGIN, HANDOFF_HEADER_END);
  let rest = head ? head.rest : raw;
  let heartbeat: string[] = [];
  const log = cutBlock(rest, HANDOFF_LOG_BEGIN, HANDOFF_LOG_END);
  if (log) {
    heartbeat = log.inner.split("\n").filter((l) => l.trim() !== "");
    rest = log.rest;
  }
  return { header: head?.inner ?? "", heartbeat, body: rest, raw };
}

/** The written part of a handoff, an older norn's generated blocks (and the blank line after them) dropped; prose kept as written. */
export function handoffProse(raw: string): string {
  const h = parseHandoff(raw);
  return h.body === raw ? raw : h.body.replace(/^\n/, "");
}

/** A unit's handoff at `file`, the path its resolver gives (`handoffPath`). */
export function readHandoff(file: string): Handoff | null {
  const raw = readText(file);
  return raw === null ? null : parseHandoff(raw);
}

/**
 * Before a unit's boundary commit, a handoff that does not exist yet gets the Goal /
 * Progress / Resume skeleton, and one an older norn wrote loses its generated header and heartbeat
 * blocks, once; any other handoff is left untouched, so a boundary the agent did not edit it in leaves it
 * out of the commit. Returns whether it wrote.
 */
export function tidyHandoff(file: string): boolean {
  const raw = readText(file);
  const next = raw === null ? HANDOFF_SKELETON : handoffProse(raw);
  if (next === raw) return false;
  atomicWrite(file, next);
  return true;
}

/** Replace the written part (`norn done --handoff`'s Progress line, a person's reject reason); an older norn's generated blocks go with it. */
export function writeHandoffBody(file: string, body: string): Handoff {
  atomicWrite(file, body);
  return { header: "", heartbeat: [], body, raw: body };
}
