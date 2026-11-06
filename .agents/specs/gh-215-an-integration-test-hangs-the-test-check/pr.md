## Summary

In the integration and e2e tiers, a sync child process that never exits now fails its own test, with the test named, instead of hanging the whole `--parallel` run until the check's 15-min timeout. bun 1.3.13 cannot stop a test stuck in `Bun.spawnSync` at the per-test timeout once its file has already run another `spawnSync`. One stuck git child (on CI it was in `upgrade-records.test.ts`, not the suspected `upgrade-version.test.ts`) therefore blocked its worker and the run, and no failing test was named.

```diff
 spawning-tier-preload.ts            (integration + e2e only; real runs unchanged, H11 holds)
   allowSpawns()
+  installSpawnSyncBound()           // Bun.spawnSync with no `timeout` → timeout 15 s (< 20 s per test), SIGKILL
+                                    // a call that sets its own timeout keeps it

 harness sh(cwd, args)
-  spawnSyncCaptured(["git", …args])
+  spawnSyncCaptured(["git", …args], { timeoutMs: 15 s })
+  on timeout → throw "git <args> (<cwd>): timed out after N ms (killed)"
```

The bound covers harness `sh()`, norn's in-process store `gitSync` and `ps` probes (called through `runCli`), and a test file's own `Bun.spawnSync`.

## Evidence

- **Wanted: a stuck harness git call fails its test, named, and the run goes on**
  **Before:** a fixture run under `bun test --timeout=5000` (a quick `sh()`, then `sh()` on a git alias that sleeps 60 s, then a passing test) printed nothing and was killed at the 15 s outer bound (15 006 ms).
  **After:** `harness-git-timeout.test.ts` › "a harness git call that never exits fails its test, named…" checks `ends < 15 s`, `"(fail) stuck git call"`, `"timed out after 1000 ms (killed)"` and `2 pass, 1 fail`. The run takes about 1.3 s and passed 3/3.
- **Wanted: the integration tier never hangs past the per-test timeout (any stuck test fails named)**
  **Before:** the same kind of fixture, with a stuck in-process `gitSync` and a stuck direct `Bun.spawnSync`, was killed at the 15 s bound (15 008 ms).
  **After:** `harness-git-timeout.test.ts` › "norn's in-process git call or a test's own spawnSync that never exits fails its test, named" checks `ends < 15 s`, both stuck tests show as `(fail)`, and the result is `2 pass, 2 fail`. The run takes about 3.6 s and passed 3/3. The unit test `test/repo/spawn-sync-bound.test.ts` pins the wrapper: both call shapes get the bound, and a call's own timeout is kept.
  **Not shown:** blocks that are not spawns, such as a blocking synchronous read or a busy loop, still cannot be stopped at the per-test timeout. The observed hang was a sync spawn. What made the git child stick on CI was not reproduced (18+ isolated runs and 3 loaded full-tier runs were all green). This change makes such a hang fail named instead of silent.
- Unit tier (1279 pass) and typecheck are green. `upgrade-records.test.ts` and store `spawn.test.ts` are green with the integration config.

## Merge danger

**Door:** two-way: the change is test support only (a preload and the harness), and a revert removes it completely.

**Blast radius:** CI: a legitimate sync spawn in a test that runs longer than 15 s without setting its own `timeout` would now be killed and fail. Review checked every `Bun.spawnSync` in norn's sources and found only short local calls; remote git calls set their own timeout. A killed child's grandchildren are orphaned until they exit, because `Bun.spawnSync` has no process-group option. This leaks a process but does not block a test.
