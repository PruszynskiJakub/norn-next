/**
 * Machine-wide leases in `~/.norn/leases/` (K1, K3) and worktree env files (K4).
 *
 * Every lease is a numbered file `<kind>-<n>.json` created exclusively, so caps are
 * enforced atomically: agent/check leases use n ∈ 1..max_agents / 1..max_checks; slot
 * leases use n = slot number ∈ slots.min..slots.max. A file whose holder is dead is
 * reclaimed (moved aside only if unchanged since judged dead).
 *
 * Liveness is injectable. Default: agent/check leases live while the holder process
 * (pid + start time) lives; slot leases live while their worktree directory exists
 * (worktrees outlive the tick that allocated the slot), else by holder process.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { FileError } from "@norn/core";
import type { LeaseFile, LeaseKind, ProcessIdentity, SlotConfig } from "@norn/schema";
import { assertValid, isSliceKey, isStoryKey } from "@norn/schema";
import { atomicWrite, atomicWriteJson, createExclusive, isErrno, json, readJsonFile, readText, safeUnlink } from "./fsx.ts";
import { removeIfUnchanged } from "./lock.ts";
import { envNornPath, leasesDir, unitMarkerPath } from "./paths.ts";
import { defaultLiveness, type LivenessCheck, localProcess } from "./proc.ts";

export type LeaseLiveness = (lease: LeaseFile) => Promise<boolean> | boolean;

export function defaultLeaseLiveness(proc: LivenessCheck = defaultLiveness): LeaseLiveness {
  return (lease) => (lease.kind === "slot" && lease.worktree ? existsSync(lease.worktree) : proc(lease.holder));
}

export const leaseFileName = (kind: LeaseKind, n: number) => `${kind}-${n}.json`;
const LEASE_NAME = /^(agent|check|slot)-(\d+)\.json$/;

export interface LeaseEntry {
  /** file name in the leases dir (ReclaimLeasesAction.files) */
  file: string;
  n: number;
  lease: LeaseFile;
}

export interface LeaseListing {
  live: LeaseEntry[];
  dead: LeaseEntry[];
  /** unreadable lease files (reclaimable with reclaimLeases) */
  errors: FileError[];
}

export async function listLeases(home: string, liveness: LeaseLiveness = defaultLeaseLiveness()): Promise<LeaseListing> {
  const dir = leasesDir(home);
  const out: LeaseListing = { live: [], dead: [], errors: [] };
  let names: string[];
  try {
    names = readdirSync(dir).sort();
  } catch (e) {
    if (isErrno(e, "ENOENT")) return out;
    throw e;
  }
  for (const name of names) {
    const m = LEASE_NAME.exec(name);
    if (!m) continue;
    const r = readJsonFile("lease", join(dir, name), dir);
    if (!r.ok) {
      if (r.reason === "corrupt") out.errors.push(r.error);
      continue;
    }
    const entry = { file: name, n: Number(m[2]), lease: r.value };
    ((await liveness(r.value)) ? out.live : out.dead).push(entry);
  }
  return out;
}

export interface LeaseRequest {
  kind: LeaseKind;
  /** inclusive number range to allocate from */
  range: { min: number; max: number };
  repo: string;
  story: string;
  slice: string | null;
  run_id: string | null;
  worktree?: string;
  /** slot leases: compute port base from the allocated number */
  portBase?: (n: number) => number;
  holder?: ProcessIdentity;
  now?: string;
  liveness?: LeaseLiveness;
}

export type LeaseResult =
  | { ok: true; entry: LeaseEntry; existed: boolean; reclaimed: LeaseEntry[] }
  | { ok: false; reason: "full"; holders: LeaseEntry[] };

function sameOwner(a: LeaseFile, req: LeaseRequest): boolean {
  if (a.kind !== req.kind || a.repo !== req.repo || a.story !== req.story || a.slice !== req.slice) return false;
  return a.kind === "slot" ? true : a.run_id !== null && a.run_id === req.run_id;
}

/**
 * Take the lowest free number in range (K1, K3). Idempotent: a live lease of the same
 * kind for the same unit (slot) or run (agent/check) is returned as is. Dead holders in
 * the way are reclaimed.
 */
export async function acquireLease(home: string, req: LeaseRequest): Promise<LeaseResult> {
  const liveness = req.liveness ?? defaultLeaseLiveness();
  const dir = leasesDir(home);
  const listing = await listLeases(home, liveness);
  const mine = listing.live.find((e) => sameOwner(e.lease, req));
  if (mine) return { ok: true, entry: mine, existed: true, reclaimed: [] };
  const reclaimed: LeaseEntry[] = [];
  for (let n = req.range.min; n <= req.range.max; n++) {
    const name = leaseFileName(req.kind, n);
    const lease: LeaseFile = {
      version: 1,
      kind: req.kind,
      ...(req.kind === "slot" ? { slot: n } : {}),
      repo: req.repo,
      story: req.story,
      slice: req.slice,
      run_id: req.run_id,
      holder: req.holder ?? localProcess.self(),
      created_at: req.now ?? new Date().toISOString(),
      ...(req.worktree ? { worktree: req.worktree } : {}),
      ...(req.portBase ? { port_base: req.portBase(n) } : {}),
    };
    assertValid("lease", lease);
    for (let tries = 0; tries < 3; tries++) {
      if (createExclusive(join(dir, name), json(lease))) return { ok: true, entry: { file: name, n, lease }, existed: false, reclaimed };
      const raw = readText(join(dir, name));
      if (raw === null) continue;
      const cur = readJsonFile("lease", join(dir, name));
      if (cur.ok && (await liveness(cur.value))) break; // taken by a live holder
      if (removeIfUnchanged(join(dir, name), raw) && cur.ok) reclaimed.push({ file: name, n, lease: cur.value });
    }
  }
  const after = await listLeases(home, liveness);
  return { ok: false, reason: "full", holders: after.live.filter((e) => e.lease.kind === req.kind) };
}

/** Agent (or check) lease within a machine cap (K1): numbers 1..max. */
export function acquireRunLease(
  home: string,
  kind: "agent" | "check",
  max: number,
  req: Omit<LeaseRequest, "kind" | "range" | "portBase">,
): Promise<LeaseResult> {
  return acquireLease(home, { ...req, kind, range: { min: 1, max } });
}

/** Port slot for a worktree (K4): slot ∈ [min, max], port_base = base + slot × ports_per_slot. */
export function acquireSlotLease(
  home: string,
  slots: SlotConfig,
  req: Omit<LeaseRequest, "kind" | "range" | "portBase" | "run_id"> & { run_id?: string | null },
): Promise<LeaseResult> {
  return acquireLease(home, {
    ...req,
    run_id: req.run_id ?? null,
    kind: "slot",
    range: { min: slots.min, max: slots.max },
    portBase: (n) => slots.port_base + n * slots.ports_per_slot,
  });
}

/** Rewrite a held lease (e.g. set holder pid / run_id after launch). */
export function updateLease(home: string, file: string, lease: LeaseFile): void {
  assertValid("lease", lease);
  atomicWriteJson(join(leasesDir(home), file), lease);
}

export function releaseLease(home: string, file: string): boolean {
  if (!LEASE_NAME.test(file)) throw new Error(`not a lease file: ${file}`);
  return safeUnlink(join(leasesDir(home), file));
}

/** Remove the named lease files whose holders are (still) dead, or that are unreadable (K3). */
export async function reclaimLeases(home: string, files: string[], liveness: LeaseLiveness = defaultLeaseLiveness()): Promise<string[]> {
  const removed: string[] = [];
  for (const file of files) {
    if (!LEASE_NAME.test(file)) continue;
    const path = join(leasesDir(home), file);
    const raw = readText(path);
    if (raw === null) continue;
    const cur = readJsonFile("lease", path);
    if (cur.ok && (await liveness(cur.value))) continue;
    if (removeIfUnchanged(path, raw)) removed.push(file);
  }
  return removed;
}

// ---------------------------------------------------------------- worktree files (A3, K4)

/** `.env.norn` values for a slot: NORN_SLOT, PORT_BASE and config extras with `{slot}`/`{port_base}` substituted. */
export function slotEnv(slot: number, slots: SlotConfig): Record<string, string> {
  const portBase = slots.port_base + slot * slots.ports_per_slot;
  const env: Record<string, string> = { NORN_SLOT: String(slot), PORT_BASE: String(portBase) };
  for (const [k, v] of Object.entries(slots.env ?? {}))
    env[k] = v.replaceAll("{slot}", String(slot)).replaceAll("{port_base}", String(portBase));
  return env;
}

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

function quote(v: string): string {
  return /^[A-Za-z0-9_./:@%+,-]*$/.test(v) ? v : `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

/** Write `.env.norn` (dotenv syntax, written by norn; do not edit). */
export function writeEnvNorn(worktree: string, env: Record<string, string>): void {
  const lines = ["# written by norn (K4); do not edit"];
  for (const [k, v] of Object.entries(env)) {
    if (!ENV_KEY.test(k)) throw new Error(`bad env key: ${k}`);
    lines.push(`${k}=${quote(v)}`);
  }
  atomicWrite(envNornPath(worktree), `${lines.join("\n")}\n`);
}

export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    let v = m[2] as string;
    if (v.startsWith('"') && v.endsWith('"') && v.length >= 2)
      v = v.slice(1, -1).replace(/\\(["\\n])/g, (_, c: string) => (c === "n" ? "\n" : c));
    out[m[1] as string] = v;
  }
  return out;
}

export function readEnvNorn(worktree: string): Record<string, string> | null {
  const text = readText(envNornPath(worktree));
  return text === null ? null : parseEnvText(text);
}

export interface UnitMarker {
  repo: string;
  story: string;
  /** null for the story worktree */
  slice: string | null;
  /** `_story` or `<nn>-<slug>` */
  unit: string;
  /** repo-relative spec folder */
  spec_dir: string;
}

/** Write `.norn-unit` (A3): `key=value` lines, so hooks can read it without JSON. */
export function writeUnitMarker(worktree: string, m: UnitMarker): void {
  const lines = [`repo=${m.repo}`, `story=${m.story}`, `slice=${m.slice ?? ""}`, `unit=${m.unit}`, `spec_dir=${m.spec_dir}`];
  atomicWrite(unitMarkerPath(worktree), `${lines.join("\n")}\n`);
}

/** null when absent; throws nothing — a malformed marker is returned as null with `exists`. */
export function readUnitMarker(worktree: string): { exists: boolean; marker: UnitMarker | null } {
  const text = readText(unitMarkerPath(worktree));
  if (text === null) return { exists: false, marker: null };
  const kv: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const slice = kv.slice ? kv.slice : null;
  const ok = !!kv.repo && isStoryKey(kv.story) && (slice === null || isSliceKey(slice)) && !!kv.unit && !!kv.spec_dir;
  return {
    exists: true,
    marker: ok ? { repo: kv.repo as string, story: kv.story as string, slice, unit: kv.unit as string, spec_dir: kv.spec_dir as string } : null,
  };
}
