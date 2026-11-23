/**
 * What a step's agent could change from a checkout, noted before it starts and compared once it
 * reports, and putting the checkout back. Every read goes through git or the host's files, so nothing
 * here writes the repo except `restore`.
 */
import { fail, type HostContext, ok, type PluginResult, type VcsSnapshot } from "@norn/plugin-api";
import { failedIn, git, gitFailure } from "./git.ts";
import { revParse } from "./refs.ts";

/** Refs norn moves itself while a run works (a fetch, a flush of its run data), so a change there is none of the agent's. */
const OWN_REFS = ["refs/remotes/", "refs/norn/"];

const digest = (text: string): string => new Bun.CryptoHasher("sha256").update(text).digest("hex");

/** The repo's own folder (where its config and hooks live), shared by every worktree. */
async function commonDir(ctx: HostContext, path: string): Promise<PluginResult<string>> {
  const out = await git(ctx, path, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return out.code === 0 ? ok(out.stdout.trim()) : failedIn(out, "rev-parse --git-common-dir", path);
}

/**
 * The throwaway index is written whole and full, so it never writes or expires the shared index
 * files a split real index reads, and never takes a sparse or fsmonitor shortcut it has no state for.
 */
const TEMP_INDEX = ["-c", "core.splitIndex=false", "-c", "index.sparse=false", "-c", "core.sparseCheckout=false", "-c", "core.fsmonitor=false"];
/** A read of the real index that never writes it back, refreshed or expanded. */
const READ_ONLY = ["--no-optional-locks", "-c", "advice.sparseIndexExpanded=false"];
const UNMERGED_SHOWN = 10;

/**
 * The tracked files as the checkout holds them, built in a throwaway index seeded from the real
 * index's entries and then given every path whose file differs from its entry. The worktree's index
 * and refs are never written, and a file whose stat changed without its content moves nothing.
 * Not `stash create`: it refreshes and writes the real index, and exits 1 saying nothing when only
 * stat data differs. Not a copy of the index file: the copy's newer mtime would trust racily clean
 * entries. Each call names its own temp file, so a tick and an agent's early `norn done` snapshotting
 * the same worktree never share one; a leftover from a crash lives in the worktree's git dir and goes
 * with it.
 */
async function trackedTree(ctx: HostContext, path: string): Promise<PluginResult<string>> {
  const where = await git(ctx, path, ["rev-parse", "--path-format=absolute", "--git-path", "norn-snapshot-index"]);
  if (where.code !== 0) return failedIn(where, "rev-parse --git-path", path);
  const tmp = `${where.stdout.trim()}.${crypto.randomUUID()}`;
  const env = { GIT_INDEX_FILE: tmp };
  try {
    const staged = await git(ctx, path, [...READ_ONLY, "ls-files", "--stage", "-z"]);
    if (staged.code !== 0) return failedIn(staged, "ls-files --stage", path);
    const unmerged = new Set<string>();
    for (const entry of staged.stdout.split("\0")) {
      const tab = entry.indexOf("\t");
      if (tab < 0) continue;
      // `<mode> <object> <stage>\t<path>`: a stage other than 0 is one side of a conflict
      if (entry.slice(0, tab).split(" ")[2] !== "0") unmerged.add(entry.slice(tab + 1));
    }
    if (unmerged.size > 0) {
      const shown = [...unmerged].slice(0, UNMERGED_SHOWN).join(", ");
      return fail("conflict", `git: ${path} has unmerged paths, a merge stopped on its conflicts: ${shown}`, false);
    }
    if (staged.stdout !== "") {
      const seed = await git(ctx, path, [...TEMP_INDEX, "update-index", "-z", "--index-info"], staged.stdout, env);
      if (seed.code !== 0) return failedIn(seed, "update-index --index-info", path);
    }
    const differ = await git(ctx, path, [...READ_ONLY, "diff-files", "--name-only", "-z", "--no-renames"]);
    if (differ.code !== 0) return failedIn(differ, "diff-files", path);
    if (differ.stdout !== "") {
      const add = await git(ctx, path, [...TEMP_INDEX, "update-index", "-z", "--add", "--remove", "--stdin"], differ.stdout, env);
      if (add.code !== 0) return failedIn(add, "update-index --stdin", path);
    }
    const tree = await git(ctx, path, [...TEMP_INDEX, "write-tree"], undefined, env);
    if (tree.code !== 0) return failedIn(tree, "write-tree", path);
    return ok(tree.stdout.trim());
  } finally {
    // best effort: a file left here is never read again, since each call names its own
    try {
      await ctx.files.remove(tmp);
      await ctx.files.remove(`${tmp}.lock`);
    } catch {}
  }
}

async function refsDigest(ctx: HostContext, path: string): Promise<PluginResult<string>> {
  const out = await git(ctx, path, ["for-each-ref", "--format=%(refname) %(objectname)"]);
  if (out.code !== 0) return failedIn(out, "for-each-ref", path);
  return ok(digest(out.stdout.trim().split("\n").filter((l) => l !== "" && !OWN_REFS.some((p) => l.startsWith(p))).join("\n")));
}

/**
 * The tracking keys `worktree add -b` writes for a new branch and a branch delete removes, so another
 * unit starting or finishing while a run works changes them. Every push norn makes names its remote and
 * refspec, so these keys redirect none of it; `pushRemote` and the rest of a branch's section stay noted.
 */
const TRACKING_KEY = /^branch\..+\.(remote|merge)$/;

async function configDigest(ctx: HostContext, path: string): Promise<PluginResult<string>> {
  const out = await git(ctx, path, ["config", "--local", "--list", "-z"]);
  // exit 1 with nothing said is a repo with no local config
  if (out.code !== 0 && !(out.code === 1 && out.stderr.trim() === "")) return failedIn(out, "config --list", path);
  // each entry is `key\nvalue`, the key's section and name lowercased by git
  const kept = out.stdout.split("\0").filter((e) => e !== "" && !TRACKING_KEY.test(e.split("\n", 1)[0] ?? ""));
  return ok(digest(kept.join("\0")));
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
  // tree against tree: a diff against the checkout refreshes and writes the index when a file is
  // stat-dirty, and `diff-index` without `--cached` reports such a file as changed
  const now = await trackedTree(ctx, path);
  if (!now.ok) return now;
  const out = await git(ctx, path, ["diff-tree", "-r", "--name-only", "-z", "--no-renames", tree, now.value, "--"]);
  if (out.code !== 0) return failedIn(out, "diff-tree", path);
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
