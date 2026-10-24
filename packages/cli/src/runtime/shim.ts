/**
 * R8.1 (M5, A1): agents started by a runner run the norn that launched them. Act writes a shim
 * `<norn home>/bin/norn` that execs the current norn entry point, and starts the agent through a
 * launcher `<norn home>/launch/<hash>.sh` that sets `PATH=<shim dir>:…` and `NORN_BIN=<shim>`, then
 * execs the agent — inside the command itself, so a login shell in a runner pane (which re-reads
 * the user's profile) cannot put another `norn` first again. Hooks call `$NORN_BIN` when set
 * (init's default hook command).
 *
 * B2: the PATH lives in the launcher file, not on the command line. A pane runner types the command
 * into a fresh shell; an inline `env PATH=<whole PATH> …` is longer than the tty's line limit
 * (MAX_CANON, 1 024 bytes on macOS) with an ordinary PATH and is cut off unrun.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
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
 * R8.1: the launch argv run through a launcher that puts the shim dir first on PATH and sets
 * NORN_BIN, and the same two variables for the runner's own env (`--env` of a pane, the headless
 * process env). B2: the typed command is `<launcher> <agent argv…>` — short whatever PATH is.
 */
export function withNornOnPath(argv: string[], shim: string, basePath: string | undefined): { argv: string[]; env: Record<string, string> } {
  const dir = dirname(shim);
  const rest = (basePath ?? "").split(":").filter((p) => p && p !== dir);
  const env = { PATH: [dir, ...rest].join(":"), NORN_BIN: shim };
  return { argv: [ensureLauncher(dirname(dir), env), ...argv], env };
}

/** Write `<home>/launch/<hash>.sh` (atomic, S1; named by its content, so written once per PATH). Returns its path. */
export function ensureLauncher(home: string, env: { PATH: string; NORN_BIN: string }): string {
  const text = [
    "#!/bin/sh",
    "# norn-owned: runs an agent with the norn that launched it first on PATH (R8.1, B2)",
    `PATH=${proc.shellQuote(env.PATH)}; export PATH`,
    `NORN_BIN=${proc.shellQuote(env.NORN_BIN)}; export NORN_BIN`,
    'exec "$@"',
    "",
  ].join("\n");
  const path = join(home, "launch", `${createHash("sha256").update(text).digest("hex").slice(0, 16)}.sh`);
  if (!existsSync(path) || readFileSync(path, "utf8") !== text) atomicWrite(path, text, 0o755);
  return path;
}
