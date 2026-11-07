/**
 * A finished story's record is fetched from its archive ref `refs/norn/runs/<story>` only where a
 * command needs it (`run list`, `run view`; `story reopen` fetches its own), one story's ref at a time and never by a sync. A story whose run state this
 * checkout's machine dir holds, or whose ref is already here, fetches nothing. A fetch that fails
 * (offline) leaves the read on what is here: these commands only read.
 */
import { existsSync } from "node:fs";
import { fetchRecords, readRecordRef, storyRunStateDir } from "@norn/store";
import type { Context } from "../context.ts";
import { gitRemote } from "./observe/remote.ts";

/** The stories among `keys` this checkout has no record of: no run state in its machine dir and no archive ref here. */
async function missing(ctx: Context, keys: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const key of keys) if (!existsSync(storyRunStateDir(ctx.root, { key, spec_dir: "" })) && !(await readRecordRef(ctx.root, key))) out.push(key);
  return out;
}

/** Fetch the archive refs of those of `keys` this checkout has no record of; the refs fetched ([] = none). */
export async function fetchArchived(ctx: Context, keys: readonly string[]): Promise<string[]> {
  const remote = await gitRemote(ctx.git, ctx.root, ctx.config.git_remote);
  if (!remote) return [];
  const want = await missing(ctx, keys);
  return want.length ? fetchRecords(ctx.root, remote, want).catch(() => []) : [];
}
