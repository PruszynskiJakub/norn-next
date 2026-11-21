/**
 * What a step's agent could change from a checkout, noted before it starts and compared once it
 * reports, and putting the checkout back. Every read goes through git or the host's files, so nothing
 * here writes the repo except `restore`.
 */
import { fail, type HostContext, ok, type PluginResult, type VcsSnapshot } from "@norn/plugin-api";
import { git, gitFailure, must } from "./git.ts";
import { revParse } from "./refs.ts";

/** Refs norn moves itself while a run works (a fetch, a flush of its run data), so a change there is none of the agent's. */
const OWN_REFS = ["refs/remotes/", "refs/norn/"];

const digest = (text: string): string => new Bun.CryptoHasher("sha256").update(text).digest("hex");

/** The repo's own folder (where its config and hooks live), shared by every worktree. */
async function commonDir(ctx: HostContext, path: string): Promise<PluginResult<string>> {
  return must(ctx, path, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
}

/**
 * The tracked files as the checkout holds them: `stash create` writes the commit a stash would make
 * without moving a ref or touching the checkout, and makes none when there is nothing to stash.
 */
async function trackedTree(ctx: HostContext, path: string): Promise<PluginResult<string>> {
  const stash = await must(ctx, path, ["stash", "create"]);
  if (!stash.ok) return stash;
  return must(ctx, path, ["rev-parse", "--verify", `${stash.value || "HEAD"}^{tree}`]);
}

async function refsDigest(ctx: HostContext, path: string): Promise<PluginResult<string>> {
  const out = await must(ctx, path, ["for-each-ref", "--format=%(refname) %(objectname)"]);
  if (!out.ok) return out;
  return ok(digest(out.value.split("\n").filter((l) => l !== "" && !OWN_REFS.some((p) => l.startsWith(p))).join("\n")));
}

async function configDigest(ctx: HostContext, path: string): Promise<PluginResult<string>> {
  const out = await git(ctx, path, ["config", "--local", "--list", "-z"]);
  // exit 1 with nothing said is a repo with no local config
  if (out.code !== 0 && !(out.code === 1 && out.stderr.trim() === "")) return gitFailure(out, "config --list");
  return ok(digest(out.stdout));
}

/** The repo's own hooks folder, whatever `core.hooksPath` says: a change to that setting is the config's. */
async function hooksDigest(ctx: HostContext, common: string): Promise<PluginResult<string>> {
  const dir = `${common}/hooks`;
  try {
    const parts: string[] = [];
    for (const name of await ctx.files.list(dir)) parts.push(`${name}\0${(await ctx.files.read(`${dir}/${name}`)) ?? ""}`);
    return ok(digest(parts.join("\0\0")));
  } catch (e) {
    return fail("unknown", `git: cannot read the hooks in ${dir}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function snapshot(ctx: HostContext, path: string): Promise<PluginResult<VcsSnapshot>> {
  const common = await commonDir(ctx, path);
  if (!common.ok) return common;
  const head = await revParse(ctx, path, "HEAD");
  if (!head.ok) return head;
  const tree = await trackedTree(ctx, path);
  if (!tree.ok) return tree;
  const refs = await refsDigest(ctx, path);
  if (!refs.ok) return refs;
  const config = await configDigest(ctx, path);
  if (!config.ok) return config;
  const hooks = await hooksDigest(ctx, common.value);
  if (!hooks.ok) return hooks;
  return ok({ head: head.value, tree: tree.value, refs: refs.value, config: config.value, hooks: hooks.value });
}

/** Tracked paths differing from `tree`, read with `-z` so a path git would quote comes back as it is named. */
export async function changedSince(ctx: HostContext, path: string, tree: string): Promise<PluginResult<string[]>> {
  if (tree.startsWith("-")) return fail("invalid", `git: ${tree} is not a tree`, false);
  const out = await git(ctx, path, ["diff", "--name-only", "-z", "--no-renames", tree, "--"]);
  if (out.code !== 0) return gitFailure(out, "diff");
  return ok([...new Set(out.stdout.split("\0").filter((p) => p !== ""))].sort());
}

/** The paths of `paths` that `tree` holds. */
async function inTree(ctx: HostContext, path: string, tree: string, paths: readonly string[]): Promise<PluginResult<Set<string>>> {
  const out = await git(ctx, path, ["ls-tree", "-r", "-z", "--name-only", "--full-tree", tree, "--", ...paths]);
  if (out.code !== 0) return gitFailure(out, "ls-tree");
  return ok(new Set(out.stdout.split("\0").filter((p) => p !== "")));
}

/**
 * The branch moved back to `head` keeping the checkout (`reset --mixed`), then each path checked out
 * from the tree, or removed where the tree lacks it. Each part reads where the checkout is first, so
 * a repeat after a crash finds the work done.
 */
export async function restore(ctx: HostContext, path: string, to: { head: string; tree: string }, paths: readonly string[]): Promise<PluginResult<void>> {
  if (to.head.startsWith("-") || to.tree.startsWith("-")) return fail("invalid", `git: ${to.head} or ${to.tree} is not a commit or tree`, false);
  const now = await revParse(ctx, path, "HEAD");
  if (!now.ok) return now;
  if (now.value !== to.head) {
    const reset = await git(ctx, path, ["reset", "-q", "--mixed", to.head]);
    if (reset.code !== 0) return gitFailure(reset, "reset");
  }
  if (paths.length === 0) return ok(undefined);
  const held = await inTree(ctx, path, to.tree, paths);
  if (!held.ok) return held;
  const back = paths.filter((p) => held.value.has(p));
  const gone = paths.filter((p) => !held.value.has(p));
  if (back.length > 0) {
    const out = await git(ctx, path, ["checkout", to.tree, "--", ...back]);
    if (out.code !== 0) return gitFailure(out, "checkout");
  }
  if (gone.length > 0) {
    const out = await git(ctx, path, ["rm", "-q", "-f", "--ignore-unmatch", "--", ...gone]);
    if (out.code !== 0) return gitFailure(out, "rm");
    // a file a dropped commit added is untracked once the branch moved back, which git rm leaves
    try {
      for (const p of gone) await ctx.files.remove(`${path}/${p}`);
    } catch (e) {
      return fail("unknown", `git: cannot remove what the snapshot lacked in ${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return ok(undefined);
}
