/**
 * Store "local" on an in-memory host, shaped as the store suite's world. `failing` makes every file
 * call reject, as a lost disk would; the twin is a second store over the same files, as a second
 * process on this machine would open it.
 */
import { type MemoryFiles, manualClock, memoryFiles, memoryHost, type StoreWorld } from "@norn/conformance";
import type { HostContext, HostFiles } from "@norn/plugin-api";
import { createLocalStore, type LocalStoreOptions } from "../../src/index.ts";

export const DATA_DIR = "/machine/repo";
export const RUNS = `${DATA_DIR}/runs-v2`;
export const START = "2026-11-17T10:00:00.000Z";

export interface LocalStoreWorld extends StoreWorld {
  files: MemoryFiles;
  ctx: HostContext;
}

export function failable(inner: HostFiles, down: () => boolean): HostFiles {
  const guard =
    <A extends unknown[], R>(op: string, fn: (...a: A) => Promise<R>) =>
    async (...a: A): Promise<R> => {
      if (down()) throw new Error(`${op}: disk gone (injected)`);
      return fn(...a);
    };
  return {
    read: guard("read", inner.read),
    write: guard("write", inner.write),
    create: guard("create", inner.create),
    list: guard("list", inner.list),
    remove: guard("remove", inner.remove),
  };
}

export function localStoreWorld(opts: LocalStoreOptions = {}, files: MemoryFiles = memoryFiles()): LocalStoreWorld {
  let down = false;
  const clock = manualClock(START);
  const ctx = memoryHost({ files: failable(files, () => down), now: clock.now, repo: { root: "/repo", dataDir: DATA_DIR } });
  return {
    store: createLocalStore(ctx, {}, opts),
    twin: () => createLocalStore(ctx, {}, opts),
    files,
    ctx,
    now: clock.now,
    advance: clock.advance,
    failing: (on) => {
      down = on;
    },
  };
}
