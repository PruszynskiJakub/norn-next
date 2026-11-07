/**
 * A bound on every `Bun.spawnSync` in the spawning tiers (integration, e2e). bun test (1.3.13)
 * cannot cut a test stuck in `Bun.spawnSync` at its per-test timeout once its file has run another
 * `spawnSync`, so one child that never exits (a harness `sh()`, norn's own in-process `gitSync`, which
 * has no timeout for local git subcommands by H11, or a test file's direct call) blocked its worker and
 * the whole `--parallel` tier with no test named. The spawning-tier preload wraps `Bun.spawnSync` so a
 * call that sets no `timeout` gets this one: the child is killed, the call returns with
 * `exitedDueToTimeout`, and the test goes on to fail, named. Real runs keep H11: only tests load this.
 */

/** Below the tiers' 20 s per-test timeout. `NORN_TEST_SPAWN_SYNC_TIMEOUT_MS` lowers it for the test that proves it. */
const SPAWN_SYNC_TIMEOUT_MS = 15_000;

export function spawnSyncTimeoutMs(): number {
  return Number(process.env.NORN_TEST_SPAWN_SYNC_TIMEOUT_MS) || SPAWN_SYNC_TIMEOUT_MS;
}

type SpawnSync = (...args: unknown[]) => unknown;

/**
 * `real` with a default timeout: `Bun.spawnSync(cmd, options)` and `Bun.spawnSync({ cmd,...options })`
 * that set no `timeout` get `timeoutMs()` and `killSignal: "SIGKILL"`; a call that sets its own keeps it.
 */
export function boundSpawnSync(real: SpawnSync, timeoutMs: () => number = spawnSyncTimeoutMs): SpawnSync {
  const withBound = (opts: unknown): Record<string, unknown> => {
    const o = (opts ?? {}) as Record<string, unknown>;
    return o.timeout === undefined ? { ...o, timeout: timeoutMs(), killSignal: "SIGKILL" } : o;
  };
  return (...args: unknown[]) => (Array.isArray(args[0]) ? real(args[0], withBound(args[1]), ...args.slice(2)) : real(withBound(args[0]), ...args.slice(1)));
}

/** Wraps this process's `Bun.spawnSync` with `boundSpawnSync`. */
export function installSpawnSyncBound(): void {
  const bun = Bun as unknown as { spawnSync: SpawnSync };
  bun.spawnSync = boundSpawnSync(bun.spawnSync);
}
