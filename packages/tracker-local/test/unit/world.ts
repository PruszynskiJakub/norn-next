/**
 * The local tracker on an in-memory host, shaped as the contract suite's world. `failing` makes
 * every file call and git reject, as a lost disk would, so whoami fails too.
 */
import { type MemoryFiles, memoryFiles, memoryHost, type ScriptedExec, scriptedExec, type SeedItem, steppingClock, type TrackerWorld } from "@norn/conformance";
import type { HostFiles } from "@norn/plugin-api";
import { createLocalTracker, type LocalTrackerConfig, parseItem, renderItem } from "../../src/index.ts";

export const DATA_DIR = "/machine/repo";
export const ITEMS_DIR = `${DATA_DIR}/tracker`;
export const ME = "me@example.com";

export interface LocalWorld extends TrackerWorld {
  files: MemoryFiles;
  exec: ScriptedExec;
}

function failable(inner: HostFiles, down: () => boolean): HostFiles {
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

export function localWorld(config: LocalTrackerConfig = {}, seed: Record<string, string> = {}): LocalWorld {
  let down = false;
  const files = memoryFiles(seed);
  const exec = scriptedExec((argv) => {
    if (argv.join(" ") !== "git config user.email") return undefined;
    return down ? { code: 128, stderr: "fatal: not a git repository" } : { stdout: `${ME}\n` };
  });
  const now = steppingClock("2026-11-17T10:00:00.000Z");
  const ctx = memoryHost({ files: failable(files, () => down), exec, now, repo: { root: "/repo", dataDir: DATA_DIR } });
  const tracker = createLocalTracker(ctx, config);
  const dir = (config.dir ?? ITEMS_DIR).replace(/\/+$/, "");
  return {
    tracker,
    files,
    exec,
    seed: async (items: SeedItem[]) => {
      for (const name of await files.list(dir)) await files.remove(`${dir}/${name}`);
      for (const s of items) {
        const at = now();
        const fm = { title: s.title, open: s.open, assignees: s.assignees, labels: s.labels, created_at: at, updated_at: at, receipts: {} };
        await files.write(`${dir}/${s.id}.md`, renderItem({ frontmatter: fm, body: s.body, comments: [] }));
      }
    },
    failing: (on) => {
      down = on;
    },
    comments: async (id) => {
      const text = await files.read(`${dir}/${id}.md`);
      if (text === null) return [];
      const parsed = parseItem(text);
      if (!parsed.ok) throw new Error(parsed.problem);
      return parsed.value.comments.map((c) => c.body);
    },
  };
}
