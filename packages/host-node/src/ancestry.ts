/**
 * This process's ancestors and the env each was started with. A process cannot rewrite the start env
 * of a process above it, so a mark a launch put on an agent's process holds for everything below it,
 * whatever env a descendant clears for itself. Linux reads `/proc`; elsewhere `ps -E` (BSD, macOS)
 * prints the start env after the command, readable for the user's own processes.
 */
import { readFile } from "node:fs/promises";
import { nodeExec } from "./exec.ts";

export interface AncestorProcess {
  pid: number;
  /** the asked names the process was started with; null when the OS would not show its env */
  env: Record<string, string> | null;
}

/** `ps` in the C locale, as spawn.ts runs it. */
const PS_ENV = { LC_ALL: "C", LANG: "C" };
/** `ps -p` exits 1 when a listed pid is gone, still printing the others. */
const PS_SOME_GONE = 1;
/** Deeper than any real process tree, so a corrupt table cannot walk forever. */
const MAX_DEPTH = 64;

/** ppid by pid, from `ps -A -o pid= -o ppid=`. */
export function readParents(stdout: string): Map<number, number> {
  const parents = new Map<number, number>();
  for (const line of stdout.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (m) parents.set(Number(m[1]), Number(m[2]));
  }
  return parents;
}

/** `from` and the processes above it, nearest first, stopping before init, at a pid not listed, or on a cycle. */
export function chainOf(parents: ReadonlyMap<number, number>, from: number): number[] {
  const chain: number[] = [];
  for (let pid = from; pid > 1 && parents.has(pid) && !chain.includes(pid) && chain.length < MAX_DEPTH; pid = parents.get(pid) as number) chain.push(pid);
  return chain;
}

const escape = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A whole `NAME=value` word: what ps prints for each variable of a start env it shows. */
const ENV_WORD = /(?:^|\s)[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * The asked names in each line of `ps -E -ww -o pid= -o command=`. ps joins the command and the env
 * with spaces, so a variable is a whole `NAME=value` word and the last one wins: the env follows the
 * arguments. An argument shaped like one reads as one, which errs towards an agent's session. A line
 * with no variable at all is a process whose env ps would not show (macOS hides its own binaries').
 */
export function readPsEnvs(stdout: string, names: readonly string[]): Map<number, Record<string, string> | null> {
  const envs = new Map<number, Record<string, string> | null>();
  for (const line of stdout.split("\n")) {
    const m = /^\s*(\d+)\s?(.*)$/.exec(line);
    if (!m) continue;
    if (!ENV_WORD.test(m[2] as string)) {
      envs.set(Number(m[1]), null);
      continue;
    }
    const env: Record<string, string> = {};
    for (const name of names) {
      const found = [...(m[2] as string).matchAll(new RegExp(`(?:^|\\s)${escape(name)}=(\\S*)`, "g"))].at(-1);
      if (found) env[name] = found[1] as string;
    }
    envs.set(Number(m[1]), env);
  }
  return envs;
}

/** The asked names in a `/proc/<pid>/environ`, whose entries end in NUL. */
export function envFromEnviron(text: string, names: readonly string[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const entry of text.split("\0")) {
    const at = entry.indexOf("=");
    const name = entry.slice(0, at);
    if (at > 0 && names.includes(name)) env[name] = entry.slice(at + 1);
  }
  return env;
}

/** The ppid in a `/proc/<pid>/stat`; the command before it may hold spaces and parentheses. */
export function parentFromStat(text: string): number | null {
  const m = /\)\s+\S+\s+(\d+)/.exec(text.slice(text.lastIndexOf(")")));
  return m ? Number(m[1]) : null;
}

async function psAncestry(names: readonly string[]): Promise<AncestorProcess[]> {
  const table = await nodeExec(["ps", "-A", "-o", "pid=", "-o", "ppid="], { env: PS_ENV, timeoutMs: 5_000 });
  if (table.code !== 0) throw new Error(`ps -A exited ${table.code}: ${table.stderr.trim() || "no output"}`);
  const chain = chainOf(readParents(table.stdout), process.ppid);
  if (chain.length === 0) return [];
  const listed = await nodeExec(["ps", "-E", "-ww", "-o", "pid=", "-o", "command=", "-p", chain.join(",")], { env: PS_ENV, timeoutMs: 5_000 });
  if (listed.code !== 0 && listed.code !== PS_SOME_GONE) throw new Error(`ps -E exited ${listed.code}: ${listed.stderr.trim() || "no output"}`);
  const envs = readPsEnvs(listed.stdout, names);
  return chain.map((pid) => ({ pid, env: envs.get(pid) ?? null }));
}

async function procAncestry(names: readonly string[]): Promise<AncestorProcess[]> {
  const out: AncestorProcess[] = [];
  for (let pid = process.ppid; pid > 1 && out.length < MAX_DEPTH && !out.some((a) => a.pid === pid); ) {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => null);
    // gone between two reads: the chain above it is no longer this process's
    if (stat === null) break;
    const environ = await readFile(`/proc/${pid}/environ`, "utf8").catch(() => null);
    out.push({ pid, env: environ === null ? null : envFromEnviron(environ, names) });
    const parent = parentFromStat(stat);
    if (parent === null) throw new Error(`/proc/${pid}/stat names no parent`);
    pid = parent;
  }
  return out;
}

/** This process's ancestors, its parent first; rejects when the process table cannot be read. */
export function nodeAncestry(names: readonly string[]): Promise<AncestorProcess[]> {
  return process.platform === "linux" ? procAncestry(names) : psAncestry(names);
}
