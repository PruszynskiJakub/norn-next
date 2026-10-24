/**
 * Durable records (GR6, F36): the spec folders as they are on the fetched base branch
 * (`refs/remotes/<remote>/<base>`), never the person's possibly stale local `main`. A story whose
 * worktree was removed after its PR merged is still listed from here.
 *
 * The `.agents/specs/` subtree at the ref is materialized once per tree id into the gitignored
 * trace dir (`.agents/norn/trace/base/<tree>/`) so the file-based snapshot readers can load it;
 * a new tree id (the base moved) replaces the old copy. Read-only input: nothing writes there.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { atomicWrite, readText } from "./fsx.ts";
import { SPECS_DIR, traceDir } from "./paths.ts";

function gitSync(cwd: string, args: string[], input?: Uint8Array): { code: number; stdout: Buffer } {
  const p = Bun.spawnSync(["git", ...args], {
    cwd,
    stdin: input ?? "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
  });
  return { code: p.exitCode ?? 1, stdout: Buffer.from(p.stdout ?? new Uint8Array()) };
}

const baseCacheDir = (repoRoot: string) => join(traceDir(repoRoot), "base");

/**
 * The base ref to read records from: `refs/remotes/<remote>/<branch>`, the branch being the
 * cached default branch (`trace/remote.json`), else `<remote>/HEAD`, else `main`. Null when the
 * remote-tracking ref does not exist (no remote, never fetched).
 */
export function defaultBaseRef(repoRoot: string, remote: string, branch?: string | null): string | null {
  let b = branch ?? null;
  if (!b) {
    try {
      b = (JSON.parse(readText(join(traceDir(repoRoot), "remote.json")) ?? "{}") as { default_branch?: string | null }).default_branch ?? null;
    } catch {
      b = null;
    }
  }
  if (!b) {
    const r = gitSync(repoRoot, ["symbolic-ref", "--quiet", `refs/remotes/${remote}/HEAD`]);
    const ref = r.code === 0 ? r.stdout.toString().trim() : "";
    b = ref.startsWith(`refs/remotes/${remote}/`) ? ref.slice(`refs/remotes/${remote}/`.length) : "main";
  }
  const ref = `refs/remotes/${remote}/${b}`;
  return gitSync(repoRoot, ["rev-parse", "--verify", "--quiet", ref]).code === 0 ? ref : null;
}

/**
 * A directory holding `.agents/specs/` exactly as at `ref`, or null when the ref (or its specs
 * folder) does not exist. Pass the result as a snapshot root.
 */
export function baseSpecsRoot(repoRoot: string, ref: string): string | null {
  const t = gitSync(repoRoot, ["rev-parse", "--verify", "--quiet", `${ref}:${SPECS_DIR}`]);
  if (t.code !== 0) return null;
  const tree = t.stdout.toString().trim();
  if (!/^[0-9a-f]{40,64}$/.test(tree)) return null;
  const cache = baseCacheDir(repoRoot);
  const dir = join(cache, tree);
  if (existsSync(join(dir, ".complete"))) return dir;

  const ls = gitSync(repoRoot, ["ls-tree", "-r", "-z", tree]);
  if (ls.code !== 0) return null;
  const entries: Array<{ sha: string; path: string }> = [];
  for (const rec of ls.stdout.toString("utf8").split("\0")) {
    const tab = rec.indexOf("\t");
    if (tab < 0) continue;
    const [mode, type, sha] = rec.slice(0, tab).split(" ") as [string, string, string];
    const path = rec.slice(tab + 1);
    if (type !== "blob" || mode === "120000" || path.split("/").some((p) => p === ".." || p === "")) continue;
    entries.push({ sha, path });
  }
  const tmp = `${dir}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  try {
    mkdirSync(join(tmp, SPECS_DIR), { recursive: true });
    if (entries.length) {
      const out = gitSync(repoRoot, ["cat-file", "--batch"], new TextEncoder().encode(`${entries.map((e) => e.sha).join("\n")}\n`));
      if (out.code !== 0) return null;
      let pos = 0;
      for (const e of entries) {
        const nl = out.stdout.indexOf(0x0a, pos);
        const header = out.stdout.subarray(pos, nl).toString().split(" ");
        const size = Number(header[2]);
        if (header[0] !== e.sha || !Number.isFinite(size)) return null;
        const file = join(tmp, SPECS_DIR, e.path);
        mkdirSync(dirname(file), { recursive: true });
        atomicWrite(file, out.stdout.subarray(nl + 1, nl + 1 + size));
        pos = nl + 1 + size + 1;
      }
    }
    atomicWrite(join(tmp, ".complete"), `${ref}\n`);
    try {
      renameSync(tmp, dir);
    } catch {
      if (!existsSync(join(dir, ".complete"))) return null; // lost a race and the winner is incomplete
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  // the base moved on: drop older copies (best effort)
  try {
    for (const n of readdirSync(cache)) if (n !== tree && !n.includes(".tmp-")) rmSync(join(cache, n), { recursive: true, force: true });
  } catch {
    /* another tick may be cleaning up too */
  }
  return dir;
}
