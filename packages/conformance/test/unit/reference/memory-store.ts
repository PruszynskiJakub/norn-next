/**
 * The smallest store that keeps the contract, held in memory: the reference the store suite is
 * proven against. Every call yields before it acts, as real IO would, so racing calls interleave;
 * the reference stays correct by checking and writing in one synchronous step after the yield.
 */
import { manualClock, type StoreWorld } from "@norn/conformance";
import {
  artifactPathClash,
  type ClaimRecord,
  fail,
  isStoreId,
  isStoryUnit,
  normalizeArtifactPath,
  ok,
  parseUnitId,
  type PluginResult,
  type Store,
  type StoredMessage,
  type StoredReceipt,
} from "@norn/plugin-api";

export interface MemoryStoreOptions {
  start?: string;
  /**
   * A defect on purpose: every write reads what it checks before yielding and writes after, so two
   * racing writers both pass the check against the same version.
   */
  racy?: boolean;
}

interface HeldUnit {
  receipts: StoredReceipt[];
  /** the state's JSON text, so a caller mutating what it passed or read cannot reach the stored copy */
  state: { version: number; json: string } | null;
}

interface HeldMailbox {
  messages: StoredMessage[];
  /** every id ever sent, acknowledged ones included, so a resend after ack is still a replay */
  seen: Set<string>;
  acked: Set<string>;
}

interface Backing {
  units: Map<string, HeldUnit>;
  archived: Set<string>;
  claims: Map<string, ClaimRecord>;
  mailboxes: Map<string, HeldMailbox>;
  artifacts: Map<string, Map<string, string>>;
  failing: boolean;
}

const yieldOnce = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const copy = <T>(json: string): T => JSON.parse(json) as T;

function toJson(data: unknown): string | null {
  try {
    return JSON.stringify(data) ?? null;
  } catch {
    return null;
  }
}

function makeStore(b: Backing, now: () => string, racy: boolean): Store {
  const down = <T>(): PluginResult<T> => fail("unavailable", "memory store: down");
  const invalid = <T>(why: string): PluginResult<T> => fail("invalid", `memory store: ${why}`, false);
  const conflict = <T>(why: string): PluginResult<T> => fail("conflict", `memory store: ${why}`, false);
  const unitOf = (unit: string): HeldUnit => {
    let u = b.units.get(unit);
    if (!u) {
      u = { receipts: [], state: null };
      b.units.set(unit, u);
    }
    return u;
  };
  const mailboxOf = (story: string): HeldMailbox => {
    let m = b.mailboxes.get(story);
    if (!m) {
      m = { messages: [], seen: new Set(), acked: new Set() };
      b.mailboxes.set(story, m);
    }
    return m;
  };
  const artifactsOf = (story: string): Map<string, string> => {
    let a = b.artifacts.get(story);
    if (!a) {
      a = new Map();
      b.artifacts.set(story, a);
    }
    return a;
  };
  const expired = (c: ClaimRecord, at: string): boolean => Date.parse(at) >= Date.parse(c.expires_at);
  const plus = (at: string, ms: number): string => new Date(Date.parse(at) + ms).toISOString();
  const badTtl = (ttl: number): boolean => !Number.isSafeInteger(ttl) || ttl <= 0;

  /**
   * Run `check` and `write` around the yield every call makes. Kept apart, the racy defect is the
   * yield falling between them; together, nothing can change what `check` saw before `write` runs.
   */
  async function guarded<C, T>(check: () => PluginResult<C>, write: (seen: C) => PluginResult<T>): Promise<PluginResult<T>> {
    if (racy) {
      const seen = check();
      await yieldOnce();
      if (b.failing) return down();
      return seen.ok ? write(seen.value) : seen;
    }
    await yieldOnce();
    if (b.failing) return down();
    const seen = check();
    return seen.ok ? write(seen.value) : seen;
  }

  const store: Store = {
    name: "memory",
    capabilities: { shared: false, claims: "local", mailbox: true, artifacts: true },
    listUnits: async (q = {}) => {
      if (q.story !== undefined && !isStoryUnit(q.story)) return invalid(`not a story: ${q.story}`);
      await yieldOnce();
      const units = [...b.units.entries()]
        .filter(([, u]) => u.receipts.length > 0 || u.state !== null)
        .map(([id]) => id)
        .filter((id) => {
          const story = parseUnitId(id)?.story as string;
          return (q.story === undefined || story === q.story) && b.archived.has(story) === (q.archived === true);
        });
      return ok(units.sort());
    },
    readUnit: async (unit) => {
      if (!parseUnitId(unit)) return invalid(`not a unit: ${unit}`);
      await yieldOnce();
      const u = b.units.get(unit);
      return ok({
        state: u?.state ? { version: u.state.version, data: copy(u.state.json) } : null,
        receipts: (u?.receipts ?? []).map((r) => ({ ...r, data: copy(JSON.stringify(r.data)) })),
      });
    },
    appendReceipt: async (unit, r) => {
      if (!parseUnitId(unit)) return invalid(`not a unit: ${unit}`);
      if (!isStoreId(r.id)) return invalid(`not a receipt id: ${r.id}`);
      const json = toJson(r.data);
      if (json === null) return invalid("receipt data is not JSON");
      return guarded<{ known: StoredReceipt | undefined; next: number }, { seq: number; replayed: boolean }>(
        () => {
          const u = b.units.get(unit);
          const known = u?.receipts.find((x) => x.id === r.id);
          return ok({ known, next: (u?.receipts.length ?? 0) + 1 });
        },
        ({ known, next }) => {
          if (known) return ok({ seq: known.seq, replayed: true });
          const u = unitOf(unit);
          const held: StoredReceipt = { seq: next, id: r.id, at: now(), data: copy(json) };
          // a racy writer may land on a seq another took; the reference keeps whatever it was handed so the suite sees it
          u.receipts.push(held);
          u.receipts.sort((a, z) => a.seq - z.seq);
          return ok({ seq: next, replayed: false });
        },
      );
    },
    commitState: async (unit, data, expectVersion) => {
      if (!parseUnitId(unit)) return invalid(`not a unit: ${unit}`);
      const json = toJson(data);
      if (json === null) return invalid("state data is not JSON");
      return guarded(
        () => {
          const current = b.units.get(unit)?.state?.version ?? null;
          return current === expectVersion ? ok(current) : conflict<number | null>(`state is at ${current}, not ${expectVersion}`);
        },
        (current) => {
          const version = (current ?? 0) + 1;
          unitOf(unit).state = { version, json };
          return ok({ version });
        },
      );
    },
    claims: {
      read: async (story) => {
        if (!isStoryUnit(story)) return invalid(`not a story: ${story}`);
        await yieldOnce();
        const c = b.claims.get(story);
        return ok(c ? { ...c } : null);
      },
      acquire: async (story, holder, ttlMs, expectVersion) => {
        if (!isStoryUnit(story)) return invalid(`not a story: ${story}`);
        if (typeof holder !== "string" || !holder) return invalid("a claim needs a holder");
        if (badTtl(ttlMs)) return invalid(`bad claim duration ${ttlMs}`);
        return guarded(
          () => {
            const c = b.claims.get(story) ?? null;
            if (expectVersion !== undefined && (c?.version ?? null) !== expectVersion) return conflict<ClaimRecord | null>(`claim is at ${c?.version ?? null}`);
            if (c && c.holder !== holder && !expired(c, now())) return conflict<ClaimRecord | null>(`${c.holder} holds ${story}`);
            return ok(c);
          },
          (c) => {
            const at = now();
            const mine = c !== null && c.holder === holder && !expired(c, at);
            const next: ClaimRecord = { story, holder, acquired_at: mine ? c.acquired_at : at, expires_at: plus(at, ttlMs), version: (c?.version ?? 0) + 1 };
            b.claims.set(story, next);
            return ok({ ...next });
          },
        );
      },
      renew: async (story, holder, ttlMs) => {
        if (!isStoryUnit(story)) return invalid(`not a story: ${story}`);
        if (badTtl(ttlMs)) return invalid(`bad claim duration ${ttlMs}`);
        return guarded(
          () => {
            const c = b.claims.get(story);
            if (!c) return fail<ClaimRecord>("not_found", `memory store: nobody holds ${story}`, false);
            return c.holder === holder ? ok(c) : conflict<ClaimRecord>(`${c.holder} holds ${story}`);
          },
          (c) => {
            const next = { ...c, expires_at: plus(now(), ttlMs), version: c.version + 1 };
            b.claims.set(story, next);
            return ok({ ...next });
          },
        );
      },
      release: async (story, holder) => {
        if (!isStoryUnit(story)) return invalid(`not a story: ${story}`);
        return guarded(
          () => {
            const c = b.claims.get(story);
            return c && c.holder !== holder ? conflict<null>(`${c.holder} holds ${story}`) : ok(null);
          },
          () => {
            b.claims.delete(story);
            return ok(null);
          },
        );
      },
    },
    mailbox: {
      send: async (story, m) => {
        if (!isStoryUnit(story)) return invalid(`not a story: ${story}`);
        if (!isStoreId(m.id)) return invalid(`not a message id: ${m.id}`);
        const json = toJson(m.data);
        if (json === null) return invalid("message data is not JSON");
        return guarded<boolean, { replayed: boolean }>(
          () => ok(b.mailboxes.get(story)?.seen.has(m.id) ?? false),
          (seen) => {
            if (seen) return ok({ replayed: true });
            const box = mailboxOf(story);
            box.seen.add(m.id);
            box.messages.push({ id: m.id, from: m.from, at: now(), data: copy(json) });
            return ok({ replayed: false });
          },
        );
      },
      receive: async (story) => {
        if (!isStoryUnit(story)) return invalid(`not a story: ${story}`);
        await yieldOnce();
        const box = b.mailboxes.get(story);
        return ok((box?.messages ?? []).filter((m) => !box?.acked.has(m.id)).map((m) => ({ ...m, data: copy(JSON.stringify(m.data)) })));
      },
      ack: async (story, ids) => {
        if (!isStoryUnit(story)) return invalid(`not a story: ${story}`);
        return guarded(
          () => ok(null),
          () => {
            const box = mailboxOf(story);
            for (const id of ids) if (box.seen.has(id)) box.acked.add(id);
            return ok(null);
          },
        );
      },
    },
    artifacts: {
      read: async (story, path) => {
        const p = normalizeArtifactPath(path);
        if (!isStoryUnit(story) || p === null) return invalid(`no artifact ${story}:${path}`);
        await yieldOnce();
        return ok(b.artifacts.get(story)?.get(p) ?? null);
      },
      write: async (story, path, text) => {
        const p = normalizeArtifactPath(path);
        if (!isStoryUnit(story) || p === null) return invalid(`no artifact ${story}:${path}`);
        return guarded(
          () => {
            const clash = artifactPathClash(b.artifacts.get(story)?.keys() ?? [], p);
            return clash === null ? ok(null) : conflict<null>(`${p} and ${clash} cannot both be artifacts`);
          },
          () => {
            artifactsOf(story).set(p, text);
            return ok(null);
          },
        );
      },
      list: async (story) => {
        if (!isStoryUnit(story)) return invalid(`not a story: ${story}`);
        await yieldOnce();
        return ok([...(b.artifacts.get(story)?.keys() ?? [])].sort());
      },
      remove: async (story, path) => {
        const p = normalizeArtifactPath(path);
        if (!isStoryUnit(story) || p === null) return invalid(`no artifact ${story}:${path}`);
        return guarded(
          () => ok(null),
          () => {
            b.artifacts.get(story)?.delete(p);
            return ok(null);
          },
        );
      },
    },
    archive: async (story) => {
      if (!isStoryUnit(story)) return invalid(`not a story: ${story}`);
      return guarded(
        () => ok(null),
        () => {
          if (b.archived.has(story)) return ok({ archived: [] });
          b.archived.add(story);
          const moved = [...b.units.entries()].filter(([id, u]) => parseUnitId(id)?.story === story && (u.receipts.length > 0 || u.state !== null)).map(([id]) => id);
          return ok({ archived: moved.sort() });
        },
      );
    },
  };
  return store;
}

export function memoryStore(opts: MemoryStoreOptions = {}): StoreWorld {
  const clock = manualClock(opts.start ?? "2026-11-17T10:00:00.000Z");
  const b: Backing = { units: new Map(), archived: new Set(), claims: new Map(), mailboxes: new Map(), artifacts: new Map(), failing: false };
  const racy = opts.racy ?? false;
  return {
    store: makeStore(b, clock.now, racy),
    twin: () => makeStore(b, clock.now, racy),
    now: clock.now,
    advance: clock.advance,
    failing: (on) => {
      b.failing = on;
    },
  };
}
