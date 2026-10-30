/**
 * Machine-wide leases in `~/.norn/leases/` (K1, K3). Worktree env files (K4) live in worktree.ts.
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
import { assertValid } from "@norn/schema";
import { atomicWriteJson, createExclusive, isErrno, json, readJsonFile, readText, safeUnlink } from "./fsx.ts";
import { removeIfUnchanged, replaceIfUnchanged } from "./lock.ts";
import { leasesDir } from "./paths.ts";
import { defaultLiveness, type LivenessCheck, localProcess } from "./proc.ts";

export type LeaseLiveness = (lease: LeaseFile) => Promise<boolean> | boolean;

export function defaultLeaseLiveness(proc: LivenessCheck = defaultLiveness): LeaseLiveness {
  return (lease) => (lease.kind === "slot" && lease.worktree ? existsSync(lease.worktree) : proc(lease.holder));
}

const leaseFileName = (kind: LeaseKind, n: number) => `${kind}-${n}.json`;
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

/** Hand a held lease over (K1): rewrite it only while it is still exactly `from`; false when it was released or changed meanwhile. */
export function handOverLease(home: string, file: string, from: LeaseFile, to: LeaseFile): boolean {
  assertValid("lease", to);
  return replaceIfUnchanged(join(leasesDir(home), file), json(from), json(to));
}

export function releaseLease(home: string, file: string): boolean {
  if (!LEASE_NAME.test(file)) throw new Error(`not a lease file: ${file}`);
  return safeUnlink(join(leasesDir(home), file));
}

/**
 * Take a run's lease over for `holder` (K1): the process that does the run's work holds it, so the
 * lease dies with that process (K3). Only while the lease validates (S2) and still names `runId`; false otherwise.
 */
export function claimRunLease(home: string, file: string, runId: string, holder: ProcessIdentity): boolean {
  if (!LEASE_NAME.test(file)) throw new Error(`not a lease file: ${file}`);
  const path = join(leasesDir(home), file);
  const raw = readText(path);
  if (raw === null) return false;
  const cur = readJsonFile("lease", path);
  if (!cur.ok || cur.value.run_id !== runId) return false;
  if (cur.value.holder.pid === holder.pid && cur.value.holder.pid_start === holder.pid_start) return true;
  const next = { ...cur.value, holder };
  assertValid("lease", next);
  return replaceIfUnchanged(path, raw, json(next));
}

/**
 * Release a run's own lease (K1): remove the file only while it validates (S2) and still names
 * `runId`; one reclaimed (K3) and taken by another run, or one gone already, stays as it is.
 */
export function releaseRunLease(home: string, file: string, runId: string): boolean {
  if (!LEASE_NAME.test(file)) throw new Error(`not a lease file: ${file}`);
  const path = join(leasesDir(home), file);
  const raw = readText(path);
  if (raw === null) return false;
  const cur = readJsonFile("lease", path);
  if (!cur.ok || cur.value.run_id !== runId) return false;
  return removeIfUnchanged(path, raw);
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
