/** Minimal git plumbing for claim and mailbox refs (§13). Not a GitPort; adapters own that. */

export interface GitRun {
  code: number;
  stdout: string;
  stderr: string;
}

export async function git(cwd: string, args: string[], input?: string): Promise<GitRun> {
  const p = Bun.spawn(["git", ...args], {
    cwd,
    stdin: input === undefined ? "ignore" : new Response(input),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
  });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, stdout, stderr };
}

export async function gitOk(cwd: string, args: string[], input?: string): Promise<string> {
  const r = await git(cwd, args, input);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed (${r.code}): ${r.stderr.trim()}`);
  return r.stdout;
}

export const ZERO_SHA = "0000000000000000000000000000000000000000";

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
