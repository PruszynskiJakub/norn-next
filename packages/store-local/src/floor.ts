/** The norn version floor as one file beside the stories, raised only under its lock. */
import { fail, type HostContext, ok, type PluginResult, type StoreFloor } from "@norn/plugin-api";
import { compareVersions, isVersion } from "@norn/schema";
import { type LockTuning, withLock } from "./lock.ts";
import { FloorFile, readRecord } from "./records.ts";

export function floor(ctx: HostContext, path: string, tuning: LockTuning): StoreFloor {
  const read = async (): Promise<PluginResult<string | null>> => {
    const r = await readRecord(ctx, path, FloorFile);
    return r.ok ? ok(r.value?.version ?? null) : r;
  };
  return {
    read,
    raise: async (version) => {
      if (!isVersion(version)) return fail("invalid", `local store: not a version: ${JSON.stringify(version)}`, false);
      return withLock(ctx, `${path}.lock`, tuning, async () => {
        const cur = await read();
        if (!cur.ok) return cur;
        if (cur.value !== null && compareVersions(cur.value, version) >= 0) return ok({ floor: cur.value });
        const record: FloorFile = { version };
        await ctx.files.write(path, JSON.stringify(record));
        return ok({ floor: version });
      });
    },
  };
}
