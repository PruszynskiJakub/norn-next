/**
 * Closed stories (D5): a story is closed when `story.md` on its pushed story branch (the local one
 * without a remote) says `dropped`. `story close` refuses a closed story (B39); `story reopen`
 * acts only on one (B42) and offers only those (B55).
 */
import { parseSliceFileName, type SliceFrontmatter, sliceBranch, specDir, STORY_KEY_PATTERN, type StoryFrontmatter } from "@norn/schema";
import { parseSliceFile, parseStoryFile } from "@norn/store";
import type { Context } from "../context.ts";
import { failure } from "../output.ts";
import { findStoryBranch } from "./checkout.ts";
import { gitRemote } from "./observe/index.ts";

export interface PushedStory {
  key: string;
  branch: string;
  /** the ref the record was read from: the fetched remote branch, or the local one without a remote */
  rev: string;
  spec_dir: string;
  frontmatter: StoryFrontmatter;
}

/** The story's record as pushed, fetched first; null when it has no story branch. `again` is the command to retry. */
export async function pushedStory(ctx: Context, key: string, again: string): Promise<PushedStory | null> {
  const remote = await gitRemote(ctx.git, ctx.root, ctx.config.remote.git_remote);
  const branch = await findStoryBranch(ctx, key, remote);
  if (!branch) return null;
  let rev = `refs/heads/${branch}`;
  if (remote) {
    const f = await ctx.git.fetch(ctx.root, remote, [`+refs/heads/${branch}:refs/remotes/${remote}/${branch}`], { quiet: true }).catch((e: unknown) => e as Error);
    if (f instanceof Error) throw failure(`fetch failed: ${f.message}`, `retry: ${again}`, "network");
    rev = `refs/remotes/${remote}/${branch}`;
  }
  const spec_dir = specDir(key, branch.slice(key.length + 1));
  const path = `${spec_dir}/story.md`;
  const text = await ctx.git.show(ctx.root, rev, path);
  if (text === null) return null;
  const doc = parseStoryFile(text, `${rev}:${path}`);
  // S2: an unreadable record is never guessed open or closed
  if (!doc.ok) throw failure(`${rev}:${path} is unreadable (${doc.reason})`, `fix story.md on ${branch}, then ${again} again`, "story_corrupt");
  return { key, branch, rev, spec_dir, frontmatter: doc.value.frontmatter };
}

export const isClosed = (s: PushedStory | null): boolean => s?.frontmatter.status === "dropped";

/** B55: the closed stories, from the story branches on the remote (local ones without a remote), by key. */
export async function closedStories(ctx: Context, again: (key: string) => string): Promise<string[]> {
  const remote = await gitRemote(ctx.git, ctx.root, ctx.config.remote.git_remote);
  const re = new RegExp(`${STORY_KEY_PATTERN.slice(0, -1)}-[a-z0-9][a-z0-9-]*$`);
  const names = remote
    ? await ctx.git.remoteBranches(ctx.root, remote, "refs/heads/*").catch((e: unknown) => {
        throw failure(`cannot list ${remote} branches: ${(e as Error).message}`, "check the network and git credentials, then retry", "network");
      })
    : (await ctx.git.listRefs(ctx.root, "refs/heads/")).map((r) => r.ref.slice("refs/heads/".length));
  const keys = [...new Set(names.filter((n) => re.test(n)).map((n) => n.split("-").slice(0, 2).join("-")))].sort();
  const out: string[] = [];
  for (const key of keys) if (isClosed(await pushedStory(ctx, key, again(key)))) out.push(key);
  return out;
}

/**
 * The slice branches a closed story's units live on: the slices of the pushed record that were
 * started (`active`). Integrated and dropped slices have no worktree to restore; planned ones no branch.
 */
export async function startedSliceBranches(ctx: Context, s: PushedStory): Promise<Array<{ key: string; branch: string }>> {
  const dir = `${s.spec_dir}/slices`;
  const out: Array<{ key: string; branch: string }> = [];
  for (const name of (await ctx.git.lsTree(ctx.root, s.rev, dir)) ?? []) {
    const file = parseSliceFileName(name);
    const text = file ? await ctx.git.show(ctx.root, s.rev, `${dir}/${name}`) : null;
    if (!file || text === null) continue;
    const doc = parseSliceFile(text, `${s.rev}:${dir}/${name}`);
    const fm: SliceFrontmatter | null = doc.ok ? doc.value.frontmatter : null;
    if (fm?.status === "active") out.push({ key: `${s.key}/${file.nn}`, branch: sliceBranch(s.key, file.nn, file.slug) });
  }
  return out;
}
