/**
 * Claim refs `refs/norn/claims/<story>` (T2–T6) and mailbox refs
 * `refs/norn/inbox/<story>/<ulid>` (T9), stored as JSON blobs and updated by CAS.
 * `remote` null = solo repo without a remote: the local ref is the truth.
 * Classification helpers report facts only; whether to take/renew is decide's call.
 */
import type { ClaimState, FileError, MailboxItem } from "@norn/core";
import { type ClaimBlob, MAILBOX_KINDS, type Receipt, assertValid, claimRef, isUlid, mailboxPrefix, mailboxRef, parseDuration, validate } from "@norn/schema";
import { json } from "./fsx.ts";
import { type CasResult, casRef, git, listLocalRefs, listRemoteRefs, readBlob, readLocalRef, writeBlob } from "./git.ts";

export type ClaimRead =
  | { state: "none" }
  | { state: "present"; sha: string; blob: ClaimBlob }
  | { state: "corrupt"; sha: string; error: FileError };

function parseBlob<N extends "claim" | "receipt">(name: N, ref: string, raw: string | null) {
  if (raw === null) return { ok: false as const, error: { file: ref, errors: [{ path: "", message: "object missing" }] } };
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch (e) {
    return { ok: false as const, error: { file: ref, errors: [{ path: "", message: `invalid JSON: ${(e as Error).message}` }] } };
  }
  const r = validate(name, v);
  return r.ok ? { ok: true as const, value: r.value } : { ok: false as const, error: { file: ref, errors: r.errors } };
}

async function claimAt(cwd: string, ref: string, sha: string | null): Promise<ClaimRead> {
  if (sha === null) return { state: "none" };
  const p = parseBlob("claim", ref, await readBlob(cwd, sha));
  return p.ok ? { state: "present", sha, blob: p.value } : { state: "corrupt", sha, error: p.error };
}

/** Claim as recorded in the local ref (after the last fetch). */
export async function readLocalClaim(cwd: string, story: string): Promise<ClaimRead> {
  const ref = claimRef(story);
  return claimAt(cwd, ref, await readLocalRef(cwd, ref));
}

/**
 * Claim as on the remote now: `ls-remote`, then fetch the blob into the local ref
 * (or delete the local ref when gone). With `remote` null, the local ref.
 */
export async function readClaim(cwd: string, remote: string | null, story: string): Promise<ClaimRead> {
  const ref = claimRef(story);
  if (remote === null) return readLocalClaim(cwd, story);
  const remoteSha = (await listRemoteRefs(cwd, remote, ref)).find((r) => r.ref === ref)?.sha ?? null;
  if (remoteSha === null) {
    await git(cwd, ["update-ref", "-d", ref]);
    return { state: "none" };
  }
  if ((await readLocalRef(cwd, ref)) !== remoteSha) {
    const f = await git(cwd, ["fetch", "--quiet", "--no-tags", remote, `+${ref}:${ref}`]);
    if (f.code !== 0) throw new Error(`fetch ${ref} failed: ${f.stderr.trim()}`);
  }
  return claimAt(cwd, ref, remoteSha);
}

/** Facts view of a claim (core ClaimState): mine / other / expired by heartbeat_id and now. */
export function classifyClaim(read: ClaimRead, me: { heartbeat_id: string | null }, now: number): ClaimState {
  if (read.state === "none") return { state: "none" };
  if (read.state === "corrupt") return { state: "corrupt", sha: read.sha, error: read.error };
  if (Date.parse(read.blob.expires_at) <= now) return { state: "expired", blob: read.blob, sha: read.sha };
  return { state: me.heartbeat_id !== null && read.blob.heartbeat_id === me.heartbeat_id ? "mine" : "other", blob: read.blob, sha: read.sha };
}

/** Last written by this heartbeat: held now, or expired but not taken by another since (T5, T6). */
export function writtenHere(c: ClaimState, heartbeat_id: string): boolean {
  return c.state === "mine" || (c.state === "expired" && c.blob.heartbeat_id === heartbeat_id);
}

/**
 * A claim blob this heartbeat writes when it acquires a story (T3, T5): held for `lease` from
 * `now`. `at` is the ISO time written as renewed_at (and acquired_at unless one is kept); it
 * defaults to `now`. `forced_from` is set only by `take --force` (T8).
 */
export function newClaimBlob(o: {
  story: string;
  holder: string;
  heartbeat_id: string;
  now: number;
  lease: string;
  at?: string;
  acquired_at?: string;
  forced_from?: string;
}): ClaimBlob {
  const at = o.at ?? new Date(o.now).toISOString();
  return {
    version: 1,
    story: o.story,
    holder: o.holder,
    heartbeat_id: o.heartbeat_id,
    acquired_at: o.acquired_at ?? at,
    renewed_at: at,
    expires_at: new Date(o.now + parseDuration(o.lease)).toISOString(),
    last_tick_id: null,
    ...(o.forced_from !== undefined ? { forced_from: o.forced_from } : {}),
  };
}

export type ClaimWriteResult =
  | { ok: true; sha: string }
  | { ok: false; reason: "held"; holder: ClaimBlob; sha: string; message: string }
  | { ok: false; reason: "corrupt"; sha: string; error: FileError; message: string }
  | { ok: false; reason: "stale" | "rejected" | "network" | "other"; message: string };

function casFail(r: Extract<CasResult, { ok: false }>): ClaimWriteResult {
  return { ok: false, reason: r.reason, message: r.message };
}

/**
 * Acquire a story claim (T3, T5, T8). Fails with holder info when held by another
 * heartbeat and unexpired at `now`, unless `force` (journaled `take --force`, caller sets
 * `blob.forced_from`). A held-by-me claim is overwritten (acts as renew). A corrupt
 * claim needs `force`. Losing the CAS race re-reads and reports the winner.
 */
export async function acquireClaim(
  cwd: string,
  remote: string | null,
  blob: ClaimBlob,
  opts: { now: number; force?: boolean },
): Promise<ClaimWriteResult> {
  assertValid("claim", blob);
  const cur = await readClaim(cwd, remote, blob.story);
  const held = heldBy(cur, blob, opts);
  if (held) return held;
  const r = await writeClaim(cwd, remote, blob, cur.state === "none" ? null : cur.sha);
  // a lost race shows as stale info, or as the remote refusing to lock a ref that just moved
  if (r.ok || (r.reason !== "stale" && r.reason !== "rejected")) return r;
  const now = await readClaim(cwd, remote, blob.story);
  return heldBy(now, blob, { now: opts.now }) ?? r;
}

function heldBy(cur: ClaimRead, blob: ClaimBlob, opts: { now: number; force?: boolean }): ClaimWriteResult | null {
  if (opts.force || cur.state === "none") return null;
  if (cur.state === "corrupt") return { ok: false, reason: "corrupt", sha: cur.sha, error: cur.error, message: "claim blob is corrupt" };
  if (cur.blob.heartbeat_id !== blob.heartbeat_id && Date.parse(cur.blob.expires_at) > opts.now)
    return {
      ok: false,
      reason: "held",
      holder: cur.blob,
      sha: cur.sha,
      message: `held by ${cur.blob.holder} since ${cur.blob.acquired_at} (expires ${cur.blob.expires_at})`,
    };
  return null;
}

async function writeClaim(cwd: string, remote: string | null, blob: ClaimBlob, expected: string | null): Promise<ClaimWriteResult> {
  const sha = await writeBlob(cwd, json(blob));
  const r = await casRef(cwd, remote, claimRef(blob.story), sha, expected);
  return r.ok ? { ok: true, sha } : casFail(r);
}

/** Renew (T4): CAS from the sha this heartbeat last wrote/saw. */
export async function renewClaim(cwd: string, remote: string | null, blob: ClaimBlob, expected: string): Promise<ClaimWriteResult> {
  assertValid("claim", blob);
  return writeClaim(cwd, remote, blob, expected);
}

/** Release (T6): delete the ref by CAS. */
export async function releaseClaim(cwd: string, remote: string | null, story: string, expected: string): Promise<CasResult> {
  return casRef(cwd, remote, claimRef(story), null, expected);
}

// ---------------------------------------------------------------- mailbox (T9)

/** Push a receipt from a non-holder to `refs/norn/inbox/<story>/<id>`; `id` defaults to receipt_id. */
export async function postMailbox(
  cwd: string,
  remote: string | null,
  story: string,
  receipt: Receipt,
  id: string = receipt.receipt_id,
): Promise<{ ok: true; ref: string; sha: string } | (Extract<CasResult, { ok: false }> & { ref: string })> {
  assertValid("receipt", receipt);
  if (!(MAILBOX_KINDS as readonly string[]).includes(receipt.kind)) throw new Error(`receipt kind '${receipt.kind}' cannot go through the mailbox (T9)`);
  if (!isUlid(id)) throw new Error(`mailbox id must be a ULID: ${id}`);
  const ref = mailboxRef(story, id);
  const sha = await writeBlob(cwd, json(receipt));
  const r = await casRef(cwd, remote, ref, sha, null);
  return r.ok ? { ok: true, ref, sha } : { ...r, ref };
}

/** Mailbox items from local refs (call fetchNornRefs first), oldest ULID first. */
export async function listMailbox(cwd: string, story: string): Promise<MailboxItem[]> {
  const prefix = mailboxPrefix(story);
  const refs = (await listLocalRefs(cwd, prefix)).sort((a, b) => a.ref.localeCompare(b.ref));
  const out: MailboxItem[] = [];
  for (const { ref, sha } of refs) {
    const id = ref.slice(prefix.length);
    const p = parseBlob("receipt", ref, await readBlob(cwd, sha));
    out.push({ ref, sha, id, receipt: p.ok ? p.value : null, error: p.ok ? null : p.error });
  }
  return out;
}

/** Delete a mailbox ref after import (T9), CAS on its sha. */
export async function deleteMailbox(cwd: string, remote: string | null, ref: string, sha: string): Promise<CasResult> {
  return casRef(cwd, remote, ref, null, sha);
}
