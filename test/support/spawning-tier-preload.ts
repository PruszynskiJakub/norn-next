/**
 * Spawning tier preload: the integration config preloads it so the unit guard lets its tests start
 * child processes. Without it, bun 1.3.13's `--parallel` workers, which also load the root bunfig's
 * preloads, would run the unit guard in that tier. It also bounds every `Bun.spawnSync` (gh-215,
 * spawn-sync-bound.ts), so a child that never exits fails its test instead of hanging the tier.
 */
import { installSpawnSyncBound } from "./spawn-sync-bound.ts";
import { allowSpawns } from "./unit-guard.ts";

allowSpawns();
installSpawnSyncBound();
