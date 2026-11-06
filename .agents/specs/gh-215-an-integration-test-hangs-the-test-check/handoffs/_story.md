## Goal

Fix gh-215 (quick round): a stuck sync spawn in a spawning-tier test (harness git, norn's in-process git, a test's own `Bun.spawnSync`) fails its test, named, instead of hanging the integration tier. (Round 1, reproduce, found the cause; its findings stay below.)

## Progress

### Findings (the `## Reproduce` comment)

**Verdict:** the hang is reproduced as a mechanism, and the CI sighting is explained by it. Bun 1.3.13 cuts a test that is stuck in `Bun.spawnSync` at the per-test timeout only when no other `spawnSync` ran earlier in that file's tests. Every integration test makes many harness `sh()` / `gitSync` calls (both are `spawnSync`), so in practice a git child that does not exit is never cut. The worker blocks until the child exits, and `bun test --parallel` never ends and names no test. What made the git child stick on CI's run is **not** confirmed (see "Left open").

**The suspect file is the wrong one.** In the hung CI run (42192167752, job 127806756354), `upgrade-version.test.ts` printed 7/7 and `run-state-move.test.ts` printed 9/9. The file that stuck is `packages/cli/test/integration/upgrade-records.test.ts`. At 09:05:56Z its first test timed out:

```
packages/cli/test/integration/upgrade-records.test.ts:
killed 1 dangling process
(fail) norn upgrade moves the base's run state into archive refs (B35) > AC1: every story's ref is on the remote … 
  ^ this test timed out after 90000ms.
```

Its other 11 tests never printed, and neither did the next test's own 90 s timeout. On green runs AC1 takes about 6 s (6268 ms on run 42234925764). Two more files never printed a line: `run-rerun-check.test.ts` and `tick-timing.test.ts`. Both ran normally here (9 pass, 9 s), so they were most likely queued behind the blocked worker. The other 4 files had all reported by 09:08:08. CI ran 4 workers (`4x PARALLEL`).

#### Loop (red 3/3, about 15 s each)

`gh215-loop.test.ts` (outside the repo, imports the real harness):

```ts
import { test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sh } from "<worktree>/test/support/harness.ts";
const dir = mkdtempSync(join(tmpdir(), "gh215-"));
sh(dir, ["init", "-q"]);
const stuckGit = () => sh(dir, ["-c", "alias.stuck=!sleep 600", "stuck"]); // a git child that never exits
test("first stuck git call", () => { stuckGit(); });
test("second stuck git call", () => { stuckGit(); });
test("after", () => {});
```

```
$ GITHUB_ACTIONS=true timeout 15 bun test --parallel=1 --timeout=2000 ./gh215-loop.test.ts
bun test v1.3.13 (bf2e2cec) 1x PARALLEL
exit 124        ← red: nothing named, never ends (3/3)
```

Green means the run ends within the per-test timeout and names the stuck test as `(fail)`. (Through the harness even the first stuck `sh()` is not cut, unlike the bare probes below; the loop does not depend on which.)

#### Minimised repro (bun only, no norn code)

```ts
import { test } from "bun:test";
test("quick spawnSync", () => { Bun.spawnSync(["true"]); });
test("stuck after a quick spawnSync in an earlier test", () => { Bun.spawnSync(["sleep", "600"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }); });
```

`timeout 12 bun test --timeout=2000 ./pre-async.test.ts` → exit 124, nothing printed. Drop the first test and it fails in 2.0 s with `killed 1 dangling process` and the test named. Probes that pin the rule (each run alone and with `--parallel`):

| what the test does | cut at the timeout? |
|---|---|
| awaits a never-settling promise, in a test or a `beforeAll` | yes |
| `Bun.spawnSync` stuck, first in the file (pipes, file fds, stdin bytes, grandchild, git alias) | yes, `killed 1 dangling process` |
| `Bun.spawnSync` stuck after a `spawnSync` at module load | yes |
| `Bun.spawnSync` stuck after any `spawnSync` in an earlier test, or after an earlier cut | **no**: it runs until the child exits (30 s child → test "timed out after 2000ms" at 30 010 ms) |
| `Bun.spawnSync` stuck after an *async* timeout | yes |
| a busy JS loop or `Bun.sleepSync` | only when it ends by itself |
| a blocking read (FIFO) | **no**: the run never ends; with `--parallel=3` and 6 other files, nothing printed and no summary |
| an awaited, or left, detached `Bun.spawn` child | yes / no effect |

So one blocked worker is enough to stop the whole `--parallel` run, and the 15-min check timeout is the first thing that ends it.

#### Cause

- **Confirmed (amplifier):** a stuck `spawnSync` cannot be cut by the per-test timeout once the file has run another `spawnSync` (bun 1.3.13). The repo's sync spawns with no timeout of their own are where this bites:
  - `test/support/harness.ts:256-260`: `sh()` calls `spawnSyncCaptured(["git", …])` with no `timeoutMs`;
  - `packages/store/src/spawn.ts:192-207`: `spawnSyncCaptured` passes `timeout` to `Bun.spawnSync` only when the caller gives one;
  - `packages/store/src/git.ts:49-57`: `gitSync`, whose default comes from `gitTimeoutMs(args)`.
- **Corrected from triage:** "`spawnSync` blocks the event loop, so the timeout never fires" holds only from the second `spawnSync` on. The first is cut.
- **Not the cause:** `upgrade-version.test.ts:14` `setDefaultTimeout(60_000)`. That file finished 7/7 in the hung run. `upgrade-records.test.ts:14` (`90_000`) and `run-rerun-check.test.ts` / `tick-timing.test.ts` (`30_000`) also override the tier's 20 s, which is why AC1 failed after 90 s, not 20 s.

#### Left open (ranked, not confirmed)

The trigger, meaning which git (or other) child stuck in `upgrade-records.test.ts` on CI, did not show here:

- 18 runs of that file alone, 6 at once under full-tier load: 12/12 each time.
- 24 runs of the CI-silent files plus their neighbours.
- 3 full tiers at once (12 workers each; ~8 min each; only bounded, named per-test timeouts).

Ranked:

1. AC1's first wait was async (it was cut, with a dangling child killed). The next test's `sh()`/`gitSync` then blocked on a child that did not exit, uncuttable. Check: whether AC1's `upgrade` → `pushRecord`/`casRef` (`packages/store/src/record-ref.ts:141-160`) or its `norn sync` can wait on a git child that holds a lock or waits on the remote.
2. AC1 timed out, and its abandoned continuation keeps running against the module-level `h` (`upgrade-records.test.ts:27`, reassigned by the next test's `olderBase()`, while `afterEach` cleans up). The two then race on one repo.

#### Rules

None (test infrastructure). C5 only by analogy: a check's own timeout kills the process group, and the harness has no such bound.

#### Seam for a regression test

An integration-tier test (it starts processes, so not the unit tier). It runs a fixture file like the loop above as a child `bun test --timeout=2000` with an outer bound, and asserts two things:

- the run ends well before the bound;
- the second stuck test is named `(fail)`.

It goes red today. It turns green once harness `sh()` (and every `spawnSyncCaptured` in test support) carries its own `timeoutMs` below the tier's per-test timeout, because `Bun.spawnSync`'s own `timeout` kills the child whatever bun test does. A tier-level watchdog that names the running files when output stops would cover blocks that are not spawns (the FIFO row).

### Posted

The `## Reproduce` comment is on #215: https://github.com/PruszynskiJakub/norn-next/issues/215#issuecomment-6688881636
- reproduce#1 reproduced: Reproduced: a stuck Bun.spawnSync can't be cut by bun test's per-test timeout once the file has already run a spawnSync (bun 1.3.13), so a stuck harness sh()/gitSync child stops the whole --parallel run. The stuck file on CI was upgrade-records.test.ts. Loop red 3/3; what made the git child stick is still open (ranked hypotheses). Seam: an integration-tier test that runs a fixture under bun test; fix by giving harness sh() a timeoutMs. ## Reproduce is posted on #215.

### Fix (quick round, implement#1)

- Red first: `packages/cli/test/integration/harness-git-timeout.test.ts` runs a fixture under `bun test --timeout=5000` (quick `sh()`, then a `sh()` on a git alias that sleeps 60 s, then a passing test) with a 15 s outer bound. Before the fix: killed at the bound (15 006 ms).
- Fix: `test/support/harness.ts` `sh()` passes `timeoutMs` (15 s, below the tier's 20 s per-test timeout) to `spawnSyncCaptured`, so `Bun.spawnSync` kills the git child itself; on timeout `sh()` throws `git <args> (<cwd>): timed out after N ms (killed)`. `NORN_HARNESS_GIT_TIMEOUT_MS` lowers it (the test uses 1000). After: the fixture ends in ~1.3 s, `stuck git call` fails named, its neighbours pass; green 3/3.
- `sh()` is the only sync spawn in `test/support/`. Not changed (out of scope, noted): direct `Bun.spawnSync` calls in individual test files and `packages/adapters/test/contract/git.ts`'s helper, store's `gitSync` (no timeout for local subcommands, H11), and a tier-level watchdog for non-spawn blocks (the FIFO row). What made the git child stick on CI stays open.
- Unit tier and typecheck green.
- implement#1 done: Harness sh() now passes a 15s timeoutMs (below the tier's 20s) to spawnSyncCaptured, so a git child that never exits is killed and its test fails named, instead of blocking the worker and the whole --parallel tier (bun 1.3.13 can't cut a 2nd spawnSync). Regression test packages/cli/test/integration/harness-git-timeout.test.ts runs a stuck-git fixture under bun test: red before (hit 15s bound), green after (~1.3s, 3/3). Unit tier + typecheck green.

### Review (review#1)

| Item | Verifier | Proven by |
| --- | --- | --- |
| Wanted: a stuck harness git call (`sh()` / `h.git`) fails its test, named, and the run goes on | test | `packages/cli/test/integration/harness-git-timeout.test.ts` › "a harness git call that never exits fails its test, named, instead of hanging the run" (ran green: 1 pass, 1.3 s) |
| Wanted: the integration tier never hangs past the per-test timeout (any stuck test fails named) | test | UNTRACED (F1): norn's in-process local `gitSync` and direct `Bun.spawnSync` in test files are still unbounded |

- F1 (blocking, spec): the bound covers only harness `sh()`. Commands run in-process (`test/support/harness.ts:4`, `runCli`), so norn's own local git calls go through store `gitSync` (`packages/store/src/git.ts:50`, `gitTimeoutMs` → no timeout for local subcommands, H11) on `spawnSync`, the same uncuttable path. Reproduce's top hypothesis for the CI hang (`upgrade` → `pushRecord`/`casRef`) runs exactly there, so the observed hang can recur unchanged. Direct `Bun.spawnSync` in test files (e.g. `records.test.ts:217`, `story-reopen.test.ts:242`) is also unbounded.
- F2 (minor, standards): a `sh()` timeout SIGKILLs only git; a grandchild (the fixture's `sleep 60`) is left orphaned until it exits.
- review#1 changes_requested: Harness sh() bound is correct and its regression test is green, but it covers only the harness's own git calls. In-process norn git calls (store gitSync, local subcommands unbounded per H11) and direct spawnSync in test files can still hang the tier, including reproduce's top suspect for the CI hang. F1 blocking: add a bound the harness controls (tier watchdog or test-only in-process git timeout) plus a red-first fixture test. F2 minor: the timeout kills git only, so its grandchildren are orphaned.

### Rework (implement#2, review#1 F1/F2)

- Red first: `harness-git-timeout.test.ts` got a second fixture test (runs `bun test` with the spawning tiers' preloads): a stuck in-process store `gitSync` and a stuck direct `Bun.spawnSync` in a test file. Before the fix it hit the 15 s outer bound (15 008 ms).
- Fix (F1): `test/support/spawn-sync-bound.ts` wraps `Bun.spawnSync` so a call that sets no `timeout` gets 15 s (below the tier's 20 s) and `SIGKILL`; `spawning-tier-preload.ts` (integration and e2e) installs it. Covers harness `sh()`, every in-process norn `gitSync` / `ps` probe, and direct test-file calls. Real runs keep H11 (only tests load it). A call with its own timeout keeps it. `sh()` uses the same value (`spawnSyncTimeoutMs`) and keeps its named error; the env override is now `NORN_TEST_SPAWN_SYNC_TIMEOUT_MS`.
- After: both fixture tests green 3/3 (~3.6 s). Unit test `test/repo/spawn-sync-bound.test.ts` pins the wrapper (both call shapes, own timeout kept). Unit tier (1279) and typecheck green; ci-check and store spawn integration files still green.
- Not done: F2 (minor, reviewer: acceptable) — `Bun.spawnSync`'s timeout kills the child only, so a grandchild is orphaned until it exits; `Bun.spawnSync` has no process-group option. No tier-level watchdog either: non-spawn blocks (the FIFO row) are still uncovered; the observed hang was a spawn. What made the git child stick on CI stays open.
- implement#2 done: F1: spawning-tier preload now wraps Bun.spawnSync (test/support/spawn-sync-bound.ts) with a 15s SIGKILL default when a call sets no timeout, covering harness sh(), norn's in-process gitSync (H11 unchanged for real runs) and direct test-file spawnSync. Red-first fixture test in harness-git-timeout.test.ts (stuck in-process gitSync + direct spawnSync: 15s bound hit before, green 3/3 after, ~3.6s); unit test pins the wrapper. F2 (minor) left: spawnSync timeout kills only the child, no process-group option. Unit tier + typecheck green.

### Review (review#2)

| Item | Verifier | Proven by |
| --- | --- | --- |
| Wanted: a stuck harness git call (`sh()` / `h.git`) fails its test, named, and the run goes on | test | `packages/cli/test/integration/harness-git-timeout.test.ts` › "a harness git call that never exits fails its test, named, instead of hanging the run" |
| Wanted: the integration tier never hangs past the per-test timeout (any stuck test fails named) | test | `packages/cli/test/integration/harness-git-timeout.test.ts` › "norn's in-process git call or a test's own spawnSync that never exits fails its test, named" (covers the sync-spawn paths; the wrapper itself in `test/repo/spawn-sync-bound.test.ts`) |

- Ran: the fixture file, store `spawn.test.ts` and `upgrade-records.test.ts` with the integration config (25 pass); unit tier 1279 pass; typecheck green.
- Checked: every `Bun.spawnSync` in norn's src (store `gitSync`, `proc.ts` and `brief.ts` ps probes) is a short local call, so the 15 s default kills nothing legitimate; remote git calls set their own timeout and keep it; the unit guard's `uninstall` is only called in the unit tier.
- F1 (minor, spec): non-spawn blocks (a blocking read, the FIFO row) are still uncut; the observed hang was a sync spawn. F2 (minor): a timed-out child's grandchildren are orphaned until they exit (no process-group option on `Bun.spawnSync`).
- No blocking findings.

## Resume

review#2 approve; the next step is norn's. Nothing pending here.
