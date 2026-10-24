/**
 * R8.1 (M5, A1): agents started by a runner run the norn that launched them. Act writes a shim
 * `<norn home>/bin/norn` that execs the current norn entry point, and wraps the launch command in
 * `env PATH=<shim dir>:… NORN_BIN=<shim> …` — inside the command itself, so a login shell in a
 * runner pane (which re-reads the user's profile) cannot put another `norn` first again. Hooks
 * call `$NORN_BIN` when set (init's default hook command).
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { proc } from "@norn/adapters";
import { atomicWrite } from "@norn/store";

/** argv that runs this norn: the compiled binary, or the runtime plus the entry script. */
export function nornEntry(): string[] {
  const exe = process.execPath;
  const main = typeof Bun !== "undefined" ? Bun.main : (process.argv[1] ?? "");
  // a compiled binary embeds its entry (`/$bunfs/…`); its executable is norn itself
  if (!/^bun(\.exe)?$/.test(basename(exe)) || main.startsWith("/$bunfs") || main.includes("~BUN")) return [exe];
  // `bun …/main.ts` or the npm bundle (`norn.js`); anything else (a test runner) → the source entry
  if (/(^|\/)(main\.ts|norn\.js)$/.test(main)) return [exe, main];
  return [exe, join(import.meta.dir, "..", "main.ts")];
}

/** The shim's directory under norn's machine home (`~/.norn/bin`). */
export const shimDir = (home: string) => join(home, "bin");

/** Write `<home>/bin/norn` → `entry` (atomic, S1; rewritten only when it changes). Returns its path. */
export function ensureShim(home: string, entry: string[] = nornEntry()): string {
  const path = join(shimDir(home), "norn");
  const text = `#!/bin/sh\n# norn-owned: runs the norn that launched this agent (R8.1)\nexec ${proc.shellJoin(entry)} "$@"\n`;
  if (!existsSync(path) || readFileSync(path, "utf8") !== text) atomicWrite(path, text, 0o755);
  return path;
}

/**
 * R8.1: the launch argv with the shim dir first on PATH and NORN_BIN set inside the command, and the
 * same two variables for the runner's own env (`--env` of a pane, the headless process env).
 */
export function withNornOnPath(argv: string[], shim: string, basePath: string | undefined): { argv: string[]; env: Record<string, string> } {
  const dir = shim.slice(0, shim.lastIndexOf("/"));
  const rest = (basePath ?? "").split(":").filter((p) => p && p !== dir);
  const env = { PATH: [dir, ...rest].join(":"), NORN_BIN: shim };
  return { argv: ["env", `PATH=${env.PATH}`, `NORN_BIN=${shim}`, ...argv], env };
}
