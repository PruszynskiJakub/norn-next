/**
 * A story's artifacts under `artifacts/` on its run ref, so they travel with the run data and flush
 * publishes them together.
 */
import { artifactPathClash, isStoryUnit, normalizeArtifactPath, ok, type PluginResult, type StoreArtifacts } from "@norn/plugin-api";
import { localCell, mutate, read } from "./cell.ts";
import { conflict, invalid, type RefsContext } from "./context.ts";
import { readBlobs } from "./git.ts";
import { ARTIFACTS_DIR, artifactPath, runRef } from "./layout.ts";

function place(story: string, path: string): PluginResult<string> {
  const p = normalizeArtifactPath(path);
  if (!isStoryUnit(story) || p === null) return invalid(`no artifact ${JSON.stringify(story)}:${JSON.stringify(path)}`);
  return ok(p);
}

/** The artifact paths among a run ref's file paths. */
function artifactsIn(files: Iterable<string>): string[] {
  const prefix = `${ARTIFACTS_DIR}/`;
  return [...files].filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length));
}

export function refsArtifacts(rc: RefsContext): StoreArtifacts {
  const cell = (story: string) => localCell(rc.git, runRef(story));
  return {
    read: async (story, path) => {
      const p = place(story, path);
      if (!p.ok) return p;
      const snap = await read(rc.git, cell(story));
      if (!snap.ok) return snap;
      const sha = snap.value.files.get(artifactPath(p.value));
      if (sha === undefined) return ok(null);
      const texts = await readBlobs(rc.git, [sha]);
      return texts.ok ? ok(texts.value.get(sha) as string) : texts;
    },
    write: async (story, path, text) => {
      const p = place(story, path);
      if (!p.ok) return p;
      if (typeof text !== "string") return invalid("an artifact is text");
      return mutate(rc, cell(story), async (snap) => {
        // a name held as both a blob and a subtree is a tree git fsck refuses, so no remote would take the flush
        const clash = artifactPathClash(artifactsIn(snap.files.keys()), p.value);
        if (clash !== null) return conflict(`${p.value} and ${clash} cannot both be artifacts`);
        return ok({ result: null, writes: new Map([[artifactPath(p.value), text]]) });
      });
    },
    list: async (story) => {
      if (!isStoryUnit(story)) return invalid(`not a story: ${JSON.stringify(story)}`);
      const snap = await read(rc.git, cell(story));
      if (!snap.ok) return snap;
      return ok(artifactsIn(snap.value.files.keys()).sort());
    },
    remove: async (story, path) => {
      const p = place(story, path);
      if (!p.ok) return p;
      return mutate(rc, cell(story), async (snap) => {
        const at = artifactPath(p.value);
        return ok({ result: null, ...(snap.files.has(at) ? { writes: new Map([[at, null]]) } : {}) });
      });
    },
  };
}
