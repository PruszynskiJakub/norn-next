/**
 * Files kept on a ref only norn reads (evidence of a story's runs): each commit holds one set of files
 * at its tree root, parented on the ref's previous commit, so every earlier commit stays reachable
 * and a link pinned to one keeps working. Written from the object store alone, so no branch, index
 * or worktree is touched, and the ref moves in a call of its own, after the record naming the commit.
 */
import { fail, type HostContext, type KeptFile, ok, type PluginResult } from "@norn/plugin-api";
import { git, gitFailure, must, said } from "./git.ts";
import { isAncestor, remoteIfAny, revParse } from "./refs.ts";

/** A full ref name git accepts, never a bare branch name that git would resolve somewhere else. */
async function checkRef(ctx: HostContext, cwd: string, ref: string): Promise<PluginResult<void>> {
  if (!ref.startsWith("refs/")) return fail("invalid", `git: ${ref} is not a full ref name`, false);
  const out = await git(ctx, cwd, ["check-ref-format", ref]);
  return out.code === 0 ? ok(undefined) : fail("invalid", `git: ${ref} is not a valid ref name`, false);
}

/** A name in the tree's root: one path segment git can hold. */
const rootName = (path: string): boolean => path !== "" && path !== "." && path !== ".." && path !== ".git" && !/[/\\\0\n]/.test(path);

export async function keepFiles(ctx: HostContext, cwd: string, ref: string, files: readonly KeptFile[], message: string): Promise<PluginResult<{ commit: string }>> {
  const valid = await checkRef(ctx, cwd, ref);
  if (!valid.ok) return valid;
  if (files.length === 0) return fail("invalid", `git: no files to keep on ${ref}`, false);
  const bad = files.find((f) => !rootName(f.path));
  if (bad) return fail("invalid", `git: ${JSON.stringify(bad.path)} is not a name at the root of a tree`, false);
  if (new Set(files.map((f) => f.path)).size !== files.length) return fail("invalid", `git: a name is kept twice on ${ref}`, false);
  const parent = await revParse(ctx, cwd, ref);
  if (!parent.ok) return parent;

  const entries: string[] = [];
  for (const f of files) {
    const blob = await git(ctx, cwd, ["hash-object", "-w", "--no-filters", "--", f.at]);
    if (blob.code !== 0) return fail("not_found", `git: cannot keep ${f.at}: ${said(blob)}`, false);
    entries.push(`100644 blob ${blob.stdout.trim()}\t${f.path}\0`);
  }
  const tree = await git(ctx, cwd, ["mktree", "-z"], entries.join(""));
  if (tree.code !== 0) return gitFailure(tree, "mktree");
  const made = await must(ctx, cwd, ["commit-tree", tree.stdout.trim(), ...(parent.value === null ? [] : ["-p", parent.value]), "-m", message]);
  return made.ok ? ok({ commit: made.value }) : made;
}

export async function moveRef(ctx: HostContext, cwd: string, ref: string, commit: string): Promise<PluginResult<{ moved: boolean }>> {
  const valid = await checkRef(ctx, cwd, ref);
  if (!valid.ok) return valid;
  const target = await revParse(ctx, cwd, commit);
  if (!target.ok) return target;
  if (target.value === null) return fail("not_found", `git: ${commit} names no commit`, false);
  const at = await revParse(ctx, cwd, ref);
  if (!at.ok) return at;
  if (at.value === target.value) return ok({ moved: false });
  if (at.value !== null) {
    const builtOn = await isAncestor(ctx, cwd, at.value, target.value);
    if (!builtOn.ok) return builtOn;
    if (!builtOn.value) return fail("conflict", `git: ${commit} does not descend from ${ref}; moving it there would drop kept commits`, false);
  }
  // compare-and-swap on the commit read above, so a racing keep that moved the ref is never overwritten
  const out = await git(ctx, cwd, ["update-ref", ref, target.value, at.value ?? ""]);
  if (out.code !== 0) return fail("conflict", `git: ${ref} moved while it was being updated: ${said(out)}`, false);
  return ok({ moved: true });
}

export async function pushRef(ctx: HostContext, cwd: string, remote: string, ref: string): Promise<PluginResult<{ pushed: boolean }>> {
  const valid = await checkRef(ctx, cwd, ref);
  if (!valid.ok) return valid;
  const local = await revParse(ctx, cwd, ref);
  if (!local.ok) return local;
  if (local.value === null) return fail("not_found", `git: ${ref} names no commit to push`, false);
  const has = await remoteIfAny(ctx, cwd, remote);
  if (!has.ok) return has;
  if (has.value === null) return fail("unavailable", `git: no remote ${remote} to push ${ref} to`, false);
  // no force: git refuses a ref outside refs/heads that would not fast-forward, so kept commits on the remote stay
  const out = await git(ctx, cwd, ["push", "--porcelain", "--no-verify", remote, `${local.value}:${ref}`]);
  if (out.code !== 0) {
    if (/\[(remote )?rejected\]|non-fast-forward|fetch first|already exists/.test(`${out.stdout}\n${out.stderr}`))
      return fail("conflict", `git: ${ref} on ${remote} has commits this clone lacks; neither is pushed over the other`, false);
    return fail("unavailable", `git push of ${ref} to ${remote}: ${said(out)}`);
  }
  const line = out.stdout.split("\n").find((l) => l.endsWith(`\t${ref}`) || l.includes(`:${ref}\t`));
  return ok({ pushed: !line?.startsWith("=") });
}
