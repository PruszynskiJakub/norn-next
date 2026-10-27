/** Minimal git plumbing for claim and mailbox refs (§13). Not a GitPort; adapters own that. */
import { noteSpawn, spawnBounded } from "./spawn.ts";

export interface GitRun {
  code: number;
  stdout: string;
  stderr: string;
}

/** H11: how long a call that talks to a remote (git fetch/push, gh, glab) may take before it is killed. */
export const NETWORK_TIMEOUT_MS = 120_000;

const NETWORK_SUBCOMMANDS = new Set(["fetch", "push", "ls-remote", "pull", "clone"]);

/**
 * H11: the timeout for `git <args>` — set for subcommands that reach a remote, none for local
 * ones (a commit runs hooks; a log on a big repo is slow but finite).
 */
export function gitTimeoutMs(args: readonly string[]): number | undefined {
  let i = 0;
  while (i < args.length && args[i] === "-c") i += 2;
  return NETWORK_SUBCOMMANDS.has(args[i] ?? "") ? NETWORK_TIMEOUT_MS : undefined;
}

export async function git(cwd: string, args: string[], input?: string, opts: { timeoutMs?: number } = {}): Promise<GitRun> {
  const timeoutMs = opts.timeoutMs ?? gitTimeoutMs(args);
  const r = await spawnBounded(["git", ...args], {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
    ...(input === undefined ? {} : { stdin: input }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  return { code: r.code, stdout: r.stdout, stderr: r.stderr };
}

export interface GitSyncRun {
  /** exit code; 124 when killed by the timeout, 127 when git could not be started */
  code: number;
  /** raw bytes: `cat-file --batch` output is binary-safe only as a Buffer */
  stdout: Buffer;
  stderr: string;
}

/**
 * `git` for callers that must stay synchronous (the base records snapshot, GR6). Same environment
 * and H11 timeout rule as `git`; on timeout the child is killed and the code is 124. Never throws.
 */
export function gitSync(cwd: string, args: string[], input?: Uint8Array, opts: { timeoutMs?: number } = {}): GitSyncRun {
  const timeoutMs = opts.timeoutMs ?? gitTimeoutMs(args);
  noteSpawn(["git", ...args], cwd);
  try {
    const p = Bun.spawnSync(["git", ...args], {
      cwd,
      stdin: input ?? "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
      ...(timeoutMs === undefined ? {} : { timeout: timeoutMs, killSignal: "SIGKILL" as const }),
    });
    const stderr = Buffer.from(p.stderr ?? new Uint8Array()).toString("utf8");
    if (p.exitedDueToTimeout) {
      const note = `${["git", ...args].slice(0, 2).join(" ")} timed out after ${(timeoutMs ?? 0) / 1000}s (killed)\n`;
      return { code: 124, stdout: Buffer.from(p.stdout ?? new Uint8Array()), stderr: `${stderr}${stderr && !stderr.endsWith("\n") ? "\n" : ""}${note}` };
    }
    return { code: p.exitCode ?? 1, stdout: Buffer.from(p.stdout ?? new Uint8Array()), stderr };
  } catch (e) {
    return { code: 127, stdout: Buffer.alloc(0), stderr: e instanceof Error ? e.message : String(e) };
  }
}

export async function gitOk(cwd: string, args: string[], input?: string): Promise<string> {
  const r = await git(cwd, args, input);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed (${r.code}): ${r.stderr.trim()}`);
  return r.stdout;
}

const ZERO_SHA = "0000000000000000000000000000000000000000";

export async function writeBlob(cwd: string, content: string): Promise<string> {
  return (await gitOk(cwd, ["hash-object", "-w", "--stdin"], content)).trim();
}

export async function readBlob(cwd: string, sha: string): Promise<string | null> {
  const r = await git(cwd, ["cat-file", "blob", sha]);
  return r.code === 0 ? r.stdout : null;
}

export async function readLocalRef(cwd: string, ref: string): Promise<string | null> {
  const r = await git(cwd, ["rev-parse", "--verify", "--quiet", ref]);
  return r.code === 0 ? r.stdout.trim() : null;
}

export async function listLocalRefs(cwd: string, prefix: string): Promise<Array<{ ref: string; sha: string }>> {
  const out = await gitOk(cwd, ["for-each-ref", "--format=%(objectname) %(refname)", prefix]);
  return parseRefLines(out);
}

export async function listRemoteRefs(cwd: string, remote: string, pattern: string): Promise<Array<{ ref: string; sha: string }>> {
  const out = await gitOk(cwd, ["ls-remote", remote, pattern]);
  return parseRefLines(out.replace(/\t/g, " "));
}

function parseRefLines(out: string): Array<{ ref: string; sha: string }> {
  return out
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [sha, ref] = l.split(" ") as [string, string];
      return { sha, ref };
    });
}

export type CasResult =
  | { ok: true }
  | { ok: false; reason: "stale" | "rejected" | "network" | "other"; message: string };

/**
 * Compare-and-swap one ref (T3). `expected` null = ref must not exist; `sha` null deletes.
 * With a remote: `git push --force-with-lease=<ref>:<expected> <remote> <sha>:<ref>`, then the
 * local copy is updated to match. Without (solo, no remote): `git update-ref` with old value.
 */
export async function casRef(cwd: string, remote: string | null, ref: string, sha: string | null, expected: string | null): Promise<CasResult> {
  if (remote === null) {
    const args = sha === null ? ["update-ref", "-d", ref, expected ?? ZERO_SHA] : ["update-ref", ref, sha, expected ?? ZERO_SHA];
    if (sha === null && expected === null) return { ok: true };
    const r = await git(cwd, args);
    return r.code === 0 ? { ok: true } : { ok: false, reason: "stale", message: r.stderr.trim() };
  }
  const r = await git(cwd, ["push", "--porcelain", `--force-with-lease=${ref}:${expected ?? ""}`, remote, `${sha ?? ""}:${ref}`]);
  if (r.code !== 0) {
    const text = `${r.stdout}\n${r.stderr}`;
    const reason = /stale info/.test(text)
      ? "stale"
      : /\[rejected\]|\[remote rejected\]/.test(text)
        ? "rejected"
        : /Could not read from remote|unable to access|Connection|resolve host|does not appear to be a git repository/i.test(text)
          ? "network"
          : "other";
    return { ok: false, reason, message: text.trim() };
  }
  // mirror locally so later reads without fetch agree
  if (sha === null) await git(cwd, ["update-ref", "-d", ref]);
  else await git(cwd, ["update-ref", ref, sha]);
  return { ok: true };
}

/** Fetch `refs/norn/*` from the remote, pruning local norn refs gone remotely (T9, H2). */
export async function fetchNornRefs(cwd: string, remote: string): Promise<void> {
  await gitOk(cwd, ["fetch", "--quiet", "--prune", "--no-tags", remote, "+refs/norn/*:refs/norn/*"]);
}

/**
 * C5 (F35): is every commit in `from..to` norn's own for `story` — a `Norn-Tick` trailer and
 * `Norn-Story: <story>` (e.g. the `ready.approve → $done` state commit) — with `from` an ancestor of
 * `to`? False when either commit is unknown here, so a head nobody can vouch for still counts as moved.
 */
export async function onlyNornCommitsSince(cwd: string, from: string, to: string, story: string): Promise<boolean> {
  if (from === to) return true;
  if ((await git(cwd, ["merge-base", "--is-ancestor", from, to])).code !== 0) return false;
  const r = await git(cwd, ["log", "--format=%H%x1f%(trailers:key=Norn-Tick,valueonly,separator=%x2C)%x1f%(trailers:key=Norn-Story,valueonly,separator=%x2C)%x1e", `${from}..${to}`, "--"]);
  if (r.code !== 0) return false;
  const recs = r.stdout.split("\x1e").map((x) => x.replace(/^\n/, "")).filter(Boolean);
  return recs.length > 0 && recs.every((rec) => {
    const [, tick, owner] = rec.split("\x1f");
    return !!tick?.trim() && owner?.trim() === story;
  });
}
