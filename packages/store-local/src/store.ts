/**
 * Store "local": every argument is checked here before any file is touched, so a refused call
 * changes nothing, and every IO rejection becomes an `unavailable` failure, since a store call never
 * throws.
 */
import { fail, type HostContext, isStoreId, isStoryUnit, normalizeArtifactPath, parseUnitId, type PluginResult, type Store } from "@norn/plugin-api";
import { artifacts } from "./artifacts.ts";
import { claims } from "./claims.ts";
import { LOCAL_STORE_CAPABILITIES, type LocalStoreConfig } from "./config.ts";
import { floor } from "./floor.ts";
import { encodeArtifactName, layout } from "./layout.ts";
import { DEFAULT_LOCK_TUNING, errText, type LockTuning } from "./lock.ts";
import { mailbox } from "./mailbox.ts";
import { isJson } from "./records.ts";
import { units } from "./units.ts";

const NAME = "local";

const invalid = <T>(why: string): PluginResult<T> => fail("invalid", `local store: ${why}`, false);

async function guard<T>(what: string, fn: () => Promise<PluginResult<T>>): Promise<PluginResult<T>> {
  try {
    return await fn();
  } catch (e) {
    return fail("unavailable", `local store: ${what}: ${errText(e)}`);
  }
}

const badUnit = (unit: unknown) => (parseUnitId(unit) ? null : invalid<never>(`not a unit: ${JSON.stringify(unit)}`));
const badStory = (story: unknown) => (isStoryUnit(story) ? null : invalid<never>(`not a story: ${JSON.stringify(story)}`));
const badTtl = (ttl: unknown) => (typeof ttl === "number" && Number.isSafeInteger(ttl) && ttl > 0 ? null : invalid<never>(`not a duration in ms: ${String(ttl)}`));
const badName = (what: string, s: unknown) => (typeof s === "string" && s.length > 0 ? null : invalid<never>(`${what} must be a non-empty string`));
const badId = (what: string, id: unknown) => (isStoreId(id) ? null : invalid<never>(`not a ${what} id: ${JSON.stringify(id)}`));
const badData = (data: unknown) => (isJson(data) ? null : invalid<never>("data is not JSON"));
const badVersion = (v: unknown, nullable: boolean) =>
  (v === null && nullable) || (typeof v === "number" && Number.isSafeInteger(v) && v >= 1) ? null : invalid<never>(`not a version: ${String(v)}`);

/** Run `fn` unless one of the checks refused; the first refusal answers then, and nothing is touched. */
function checked<T>(checks: Array<PluginResult<never> | null>, what: string, fn: () => Promise<PluginResult<T>>): Promise<PluginResult<T>> {
  const refusal = checks.find((c) => c !== null);
  return refusal ? Promise.resolve(refusal) : guard(what, fn);
}

/** Optional knobs a test turns; the factory always takes the defaults. */
export interface LocalStoreOptions {
  lock?: Partial<LockTuning>;
}

export function createLocalStore(ctx: HostContext, _config: LocalStoreConfig = {}, opts: LocalStoreOptions = {}): Store {
  const at = layout(ctx.repo.dataDir);
  const tuning: LockTuning = { ...DEFAULT_LOCK_TUNING, ...opts.lock };
  const u = units(ctx, at, tuning);
  const c = claims(ctx, at, tuning);
  const m = mailbox(ctx, at, tuning);
  const a = artifacts(ctx, at, tuning);
  const f = floor(ctx, at.floor, tuning);

  /** An artifact path checked, normalized and encoded, or the refusal. */
  const artifactName = (story: string, path: unknown): PluginResult<string> => {
    const bad = badStory(story);
    if (bad) return bad;
    const norm = normalizeArtifactPath(path);
    if (norm === null) return invalid(`not an artifact path: ${JSON.stringify(path)}`);
    const name = encodeArtifactName(norm);
    return name === null ? invalid(`artifact path too long: ${norm}`) : { ok: true, value: name };
  };

  return {
    name: NAME,
    capabilities: LOCAL_STORE_CAPABILITIES,
    listUnits: (q = {}) => checked([q.story === undefined ? null : badStory(q.story)], "list units", () => u.list(q)),
    readUnit: (unit) => checked([badUnit(unit)], `read ${unit}`, () => u.read(unit)),
    appendReceipt: (unit, r) => checked([badUnit(unit), badId("receipt", r?.id), badData(r?.data)], `append to ${unit}`, () => u.append(unit, r)),
    commitState: (unit, data, expectVersion) =>
      checked([badUnit(unit), badData(data), badVersion(expectVersion, true)], `commit ${unit}`, () => u.commit(unit, data, expectVersion)),
    archive: (story) => checked([badStory(story)], `archive ${story}`, () => u.archive(story)),
    claims: {
      read: (story) => checked([badStory(story)], `read claim ${story}`, () => c.read(story)),
      acquire: (story, holder, ttlMs, expectVersion) =>
        checked([badStory(story), badName("holder", holder), badTtl(ttlMs), expectVersion === undefined ? null : badVersion(expectVersion, true)], `acquire ${story}`, () => c.acquire(story, holder, ttlMs, expectVersion)),
      takeOver: (story, holder, ttlMs, expectVersion) =>
        checked([badStory(story), badName("holder", holder), badTtl(ttlMs), badVersion(expectVersion, true)], `take over ${story}`, () => c.takeOver(story, holder, ttlMs, expectVersion)),
      renew: (story, holder, ttlMs) => checked([badStory(story), badName("holder", holder), badTtl(ttlMs)], `renew ${story}`, () => c.renew(story, holder, ttlMs)),
      release: (story, holder) => checked([badStory(story), badName("holder", holder)], `release ${story}`, () => c.release(story, holder)),
    },
    mailbox: {
      send: (story, msg) =>
        checked([badStory(story), badId("message", msg?.id), badName("from", msg?.from), badData(msg?.data)], `send to ${story}`, () => m.send(story, msg)),
      receive: (story) => checked([badStory(story)], `receive ${story}`, () => m.receive(story)),
      ack: (story, ids) =>
        checked([badStory(story), Array.isArray(ids) ? null : invalid("ids must be an array")], `ack ${story}`, () => m.ack(story, ids)),
    },
    artifacts: {
      read: (story, path) => withName(story, path, (name) => a.read(story, name)),
      write: (story, path, text) =>
        typeof text !== "string" ? Promise.resolve(invalid("artifact text must be a string")) : withName(story, path, (name) => a.write(story, name, text)),
      list: (story) => checked([badStory(story)], `list artifacts of ${story}`, () => a.list(story)),
      remove: (story, path) => withName(story, path, (name) => a.remove(story, name)),
    },
    floor: {
      read: () => guard("read the norn version floor", () => f.read()),
      raise: (version) => guard("raise the norn version floor", () => f.raise(version)),
    },
  };

  function withName<T>(story: string, path: string, fn: (name: string) => Promise<PluginResult<T>>): Promise<PluginResult<T>> {
    const name = artifactName(story, path);
    return name.ok ? guard(`artifact ${story}:${path}`, () => fn(name.value)) : Promise.resolve(name);
  }
}
