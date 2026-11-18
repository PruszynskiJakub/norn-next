/**
 * Real git for the git vcs: a bare repo stands in for the team's remote, one clone is the machine's
 * checkout, and another clone is a person pushing to the same remote.
 */
import { afterAll } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeHost } from "@norn/host-node";
import type { HostContext, Vcs } from "@norn/plugin-api";
import { createGitVcs } from "../../src/index.ts";

const made: string[] = [];
afterAll(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const host = createNodeHost({ root: cwd, dataDir: cwd });
  const out = await host.exec(["git", ...args], { cwd });
  if (out.code !== 0) throw new Error(`git ${args.join(" ")} in ${cwd}: ${out.stderr}`);
  return out.stdout.trim();
}

/** Write `files` in `cwd` and commit them on its branch. */
export async function commit(cwd: string, message: string, files: Record<string, string>): Promise<string> {
  for (const [name, text] of Object.entries(files)) writeFileSync(join(cwd, name), text);
  await git(cwd, "add", "-A");
  await git(cwd, "commit", "-q", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

async function identify(cwd: string): Promise<void> {
  await git(cwd, "config", "user.name", "Test");
  await git(cwd, "config", "user.email", "test@example.com");
  await git(cwd, "config", "commit.gpgsign", "false");
}

export interface World {
  dir: string;
  remote: string;
  /** the machine's checkout */
  repo: string;
  ctx: HostContext;
  vcs: Vcs;
  /** another clone of the remote, for a person pushing */
  person(): Promise<string>;
}

export async function world(): Promise<World> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "norn-vcs-git-")));
  made.push(dir);
  const remote = join(dir, "remote.git");
  await git(dir, "init", "-q", "--bare", "-b", "main", remote);
  const repo = join(dir, "repo");
  await git(dir, "init", "-q", "-b", "main", repo);
  await identify(repo);
  await git(repo, "remote", "add", "origin", remote);
  await commit(repo, "initial", { "README.md": "hello\n", "shared.txt": "one\ntwo\nthree\n" });
  await git(repo, "push", "-q", "-u", "origin", "main");
  await git(repo, "remote", "set-head", "origin", "main");
  const ctx = createNodeHost({ root: repo, dataDir: join(dir, "machine") });
  let n = 0;
  return {
    dir,
    remote,
    repo,
    ctx,
    vcs: createGitVcs(ctx, {}),
    person: async () => {
      const path = join(dir, `person-${n++}`);
      await git(dir, "clone", "-q", remote, path);
      await identify(path);
      return path;
    },
  };
}

/** Move the remote's main by one commit from a person's clone, and fetch it into the machine's checkout. */
export async function moveBase(w: World, files: Record<string, string>): Promise<string> {
  const p = await w.person();
  const sha = await commit(p, "base moves", files);
  await git(p, "push", "-q", "origin", "main");
  await git(w.repo, "fetch", "-q", "origin");
  return sha;
}

export function value<T>(r: { ok: true; value: T } | { ok: false; failure: { code: string; message: string } }): T {
  if (!r.ok) throw new Error(`expected a value, got ${r.failure.code}: ${r.failure.message}`);
  return r.value;
}
