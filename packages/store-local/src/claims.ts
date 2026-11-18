/** A story's claim as one file, changed only under its lock; time comes from the host's clock alone. */
import { type ClaimRecord, fail, type HostContext, ok, type PluginResult, type StoreClaims } from "@norn/plugin-api";
import type { Layout } from "./layout.ts";
import { type LockTuning, withLock } from "./lock.ts";
import { type ClaimFile, ClaimFile as ClaimFileSchema, corrupt, readRecord } from "./records.ts";

const expired = (c: ClaimRecord, at: string): boolean => Date.parse(at) >= Date.parse(c.expires_at);
const plus = (at: string, ms: number): string => new Date(Date.parse(at) + ms).toISOString();
const conflict = <T>(why: string): PluginResult<T> => fail("conflict", `local store: ${why}`, false);

/** The claims part; arguments are validated by the store before they reach here. */
export function claims(ctx: HostContext, at: Layout, tuning: LockTuning): Required<StoreClaims> {
  async function readFile(story: string): Promise<PluginResult<ClaimFile | null>> {
    const path = at.claim(story);
    const r = await readRecord(ctx, path, ClaimFileSchema);
    if (!r.ok || r.value === null) return r;
    const { version, claim } = r.value;
    if (claim !== null && (claim.version !== version || claim.story !== story)) return corrupt(path, `claim ${claim.story}@${claim.version} in the file of ${story}@${version}`);
    return r;
  }

  /** Read, decide and write the claim under its lock, so no two writers decide from the same version. */
  const change = <T>(story: string, decide: (cur: ClaimRecord | null, version: number, now: string) => PluginResult<{ next: ClaimRecord | null; answer: T } | { answer: T }>) =>
    withLock(ctx, `${at.claim(story)}.lock`, tuning, async (): Promise<PluginResult<T>> => {
      const file = await readFile(story);
      if (!file.ok) return file;
      const decided = decide(file.value?.claim ?? null, file.value?.version ?? 0, ctx.now());
      if (!decided.ok) return decided;
      if ("next" in decided.value) {
        const record: ClaimFile = { version: (file.value?.version ?? 0) + 1, claim: decided.value.next };
        await ctx.files.write(at.claim(story), JSON.stringify(record));
      }
      return ok(decided.value.answer);
    });

  return {
    read: async (story) => {
      const file = await readFile(story);
      return file.ok ? ok(file.value?.claim ?? null) : file;
    },

    acquire: (story, holder, ttlMs, expectVersion) =>
      change<ClaimRecord>(story, (cur, version, now) => {
        if (expectVersion !== undefined && (cur?.version ?? null) !== expectVersion) return conflict(`claim on ${story} is at ${cur?.version ?? null}, not ${expectVersion}`);
        if (cur && cur.holder !== holder && !expired(cur, now)) return conflict(`${cur.holder} holds ${story} until ${cur.expires_at}`);
        const mine = cur !== null && cur.holder === holder && !expired(cur, now);
        const next: ClaimRecord = { story, holder, acquired_at: mine ? cur.acquired_at : now, expires_at: plus(now, ttlMs), version: version + 1 };
        return ok({ next, answer: next });
      }),

    takeOver: (story, holder, ttlMs, expectVersion) =>
      change<ClaimRecord>(story, (cur, version, now) => {
        if ((cur?.version ?? null) !== expectVersion) return conflict(`claim on ${story} is at ${cur?.version ?? null}, not ${expectVersion}`);
        const mine = cur !== null && cur.holder === holder && !expired(cur, now);
        const next: ClaimRecord = { story, holder, acquired_at: mine ? cur.acquired_at : now, expires_at: plus(now, ttlMs), version: version + 1 };
        return ok({ next, answer: next });
      }),

    renew: (story, holder, ttlMs) =>
      change<ClaimRecord>(story, (cur, version, now) => {
        if (cur === null) return fail("not_found", `local store: nobody holds ${story}`, false);
        if (cur.holder !== holder) return conflict(`${cur.holder} holds ${story}, not ${holder}`);
        const next: ClaimRecord = { ...cur, expires_at: plus(now, ttlMs), version: version + 1 };
        return ok({ next, answer: next });
      }),

    release: (story, holder) =>
      change<null>(story, (cur) => {
        if (cur === null) return ok({ answer: null });
        if (cur.holder !== holder) return conflict(`${cur.holder} holds ${story}, not ${holder}`);
        return ok({ next: null, answer: null });
      }),
  };
}
