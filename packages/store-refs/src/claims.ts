/**
 * Claims as one ref per story on the remote. Every change is pushed at once under a lease on the
 * commit it was decided against, so of two machines racing for a claim the remote lets exactly one
 * through; the other reads again and, finding the claim held, answers conflict.
 */
import { type ClaimRecord, fail, isStoryUnit, ok, parseJson, type PluginResult, type StoreClaims } from "@norn/plugin-api";
import { mutate, read, remoteCell } from "./cell.ts";
import { conflict, invalid, type RefsContext } from "./context.ts";
import { readBlobs } from "./git.ts";
import { CLAIM_FILE, claimRef } from "./layout.ts";
import { ClaimFile } from "./records.ts";
import type { Snapshot } from "./tree.ts";

const expired = (c: ClaimRecord, at: string): boolean => Date.parse(at) >= Date.parse(c.expires_at);
const plus = (at: string, ms: number): string => new Date(Date.parse(at) + ms).toISOString();
const badTtl = (ttl: unknown): boolean => typeof ttl !== "number" || !Number.isSafeInteger(ttl) || ttl <= 0;
const isHeld = (f: ClaimFile | null): f is ClaimRecord => f !== null && "holder" in f;

async function claimFile(rc: RefsContext, snap: Snapshot, story: string): Promise<PluginResult<ClaimFile | null>> {
  const sha = snap.files.get(CLAIM_FILE);
  if (sha === undefined) return ok(null);
  const texts = await readBlobs(rc.git, [sha]);
  if (!texts.ok) return texts;
  return parseJson(ClaimFile, texts.value.get(sha) as string, `${story} claim`);
}

export function refsClaims(rc: RefsContext): StoreClaims {
  const cell = (story: string) => remoteCell(rc.git, rc.remote, claimRef(story));
  const write = (next: ClaimFile) => new Map([[CLAIM_FILE, JSON.stringify(next)]]);
  return {
    read: async (story) => {
      if (!isStoryUnit(story)) return invalid(`not a story: ${JSON.stringify(story)}`);
      const snap = await read(rc.git, cell(story));
      if (!snap.ok) return snap;
      const file = await claimFile(rc, snap.value, story);
      if (!file.ok) return file;
      return ok(isHeld(file.value) ? file.value : null);
    },
    acquire: async (story, holder, ttlMs, expectVersion) => {
      if (!isStoryUnit(story)) return invalid(`not a story: ${JSON.stringify(story)}`);
      if (typeof holder !== "string" || holder === "") return invalid("a claim needs a holder");
      if (badTtl(ttlMs)) return invalid(`bad claim duration ${ttlMs}`);
      return mutate(rc, cell(story), async (snap) => {
        const file = await claimFile(rc, snap, story);
        if (!file.ok) return file;
        const held = isHeld(file.value) ? file.value : null;
        if (expectVersion !== undefined && (held?.version ?? null) !== expectVersion) return conflict(`the claim on ${story} is at ${held?.version ?? null}`);
        const at = rc.now();
        if (held && held.holder !== holder && !expired(held, at)) return conflict(`${held.holder} holds ${story}`);
        const mine = held !== null && held.holder === holder && !expired(held, at);
        const next: ClaimRecord = {
          story,
          holder,
          acquired_at: mine ? held.acquired_at : at,
          expires_at: plus(at, ttlMs),
          version: (file.value?.version ?? 0) + 1,
        };
        return ok({ result: next, writes: write(next) });
      });
    },
    renew: async (story, holder, ttlMs) => {
      if (!isStoryUnit(story)) return invalid(`not a story: ${JSON.stringify(story)}`);
      if (badTtl(ttlMs)) return invalid(`bad claim duration ${ttlMs}`);
      return mutate(rc, cell(story), async (snap) => {
        const file = await claimFile(rc, snap, story);
        if (!file.ok) return file;
        const held = file.value;
        if (!isHeld(held)) return fail("not_found", `refs store: nobody holds ${story}`, false);
        if (held.holder !== holder) return conflict(`${held.holder} holds ${story}`);
        const next: ClaimRecord = { ...held, expires_at: plus(rc.now(), ttlMs), version: held.version + 1 };
        return ok({ result: next, writes: write(next) });
      });
    },
    release: async (story, holder) => {
      if (!isStoryUnit(story)) return invalid(`not a story: ${JSON.stringify(story)}`);
      return mutate(rc, cell(story), async (snap) => {
        const file = await claimFile(rc, snap, story);
        if (!file.ok) return file;
        const held = file.value;
        if (!isHeld(held)) return ok({ result: null });
        if (held.holder !== holder) return conflict(`${held.holder} holds ${story}`);
        return ok({ result: null, writes: write({ story, version: held.version + 1, released_at: rc.now() }) });
      });
    },
  };
}
