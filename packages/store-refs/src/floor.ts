/**
 * The norn version floor as one ref on the remote, pushed under a lease like a claim, so every clone
 * reads the floor the newest norn among them set, and of two racing raises the remote keeps one and
 * the other reads again and decides on it.
 */
import { ok, parseJson, type PluginResult, type StoreFloor } from "@norn/plugin-api";
import { compareVersions, isVersion } from "@norn/schema";
import { mutate, read, remoteCell } from "./cell.ts";
import { invalid, type RefsContext } from "./context.ts";
import { readBlobs } from "./git.ts";
import { FLOOR_FILE, FLOOR_REF } from "./layout.ts";
import { FloorFile } from "./records.ts";
import type { Snapshot } from "./tree.ts";

async function floorOf(rc: RefsContext, snap: Snapshot): Promise<PluginResult<string | null>> {
  const sha = snap.files.get(FLOOR_FILE);
  if (sha === undefined) return ok(null);
  const texts = await readBlobs(rc.git, [sha]);
  if (!texts.ok) return texts;
  const file = parseJson(FloorFile, texts.value.get(sha) as string, "refs store: norn version floor");
  return file.ok ? ok(file.value.version) : file;
}

export function refsFloor(rc: RefsContext): StoreFloor {
  const cell = () => remoteCell(rc.git, rc.remote, FLOOR_REF);
  return {
    read: async () => {
      const snap = await read(rc.git, cell());
      return snap.ok ? floorOf(rc, snap.value) : snap;
    },
    raise: async (version) => {
      if (!isVersion(version)) return invalid(`not a version: ${JSON.stringify(version)}`);
      return mutate(rc, cell(), async (snap) => {
        const cur = await floorOf(rc, snap);
        if (!cur.ok) return cur;
        if (cur.value !== null && compareVersions(cur.value, version) >= 0) return ok({ result: { floor: cur.value } });
        const next: FloorFile = { version };
        return ok({ result: { floor: version }, writes: new Map([[FLOOR_FILE, JSON.stringify(next)]]) });
      });
    },
  };
}
