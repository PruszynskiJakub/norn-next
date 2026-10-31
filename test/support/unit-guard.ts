/**
 * Unit guard (B4, D2): a unit test must not start a child process. The guard wraps `Bun.spawn` and
 * `Bun.spawnSync` (node's `child_process.spawn` goes through them), throws at the call, and remembers the
 * violation so `check` (the preload's `afterEach`) fails the test even when the code under test swallowed
 * the error. The message names the argv and the test file, never the spawn's env or options (they can carry
 * secrets that CI would print). Bun 1.3.13 has no current-test-name API: bun's own `(fail) <name>` line,
 * printed beside the message, names the test.
 */
import { relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..");

export interface UnitGuard {
  /** Throws the pending violation, if any, and clears it. */
  check(): void;
  /** Puts back the spawn functions the guard replaced. */
  uninstall(): void;
}

export function installUnitGuard(): UnitGuard {
  const realSpawn = Bun.spawn;
  const realSpawnSync = Bun.spawnSync;
  let pending: string | undefined;

  const block = (args: unknown[]): never => {
    const message = `unit test in ${testFile()} started \`${argvOf(args[0]).join(" ")}\`; a test that spawns belongs in test/integration/`;
    pending ??= message;
    throw new Error(message);
  };
  const bun = Bun as unknown as { spawn: unknown; spawnSync: unknown };
  bun.spawn = (...args: unknown[]) => block(args);
  bun.spawnSync = (...args: unknown[]) => block(args);

  return {
    check() {
      const message = pending;
      pending = undefined;
      if (message !== undefined) throw new Error(message);
    },
    uninstall() {
      bun.spawn = realSpawn;
      bun.spawnSync = realSpawnSync;
    },
  };
}

/** The command only: `Bun.spawn(cmd, options)` or `Bun.spawn({ cmd, ...options })`. */
function argvOf(first: unknown): string[] {
  const cmd = Array.isArray(first) ? first : (first as { cmd?: unknown } | undefined)?.cmd;
  return Array.isArray(cmd) ? cmd.map(String) : ["<unknown command>"];
}

/** The calling test file, from the stack, relative to the repo root. */
function testFile(): string {
  const stack = new Error().stack ?? "";
  const match = stack.match(/\(?((?:\/|[A-Za-z]:\\)[^():\s]+\.test\.[cm]?[jt]sx?):\d+:\d+/);
  const file = match?.[1] ?? Bun.main;
  return relative(ROOT, file);
}
