## Summary

A check step no longer runs inside the tick that starts it. The tick starts a detached `norn check-run` and returns, so `norn watch` keeps ticking: the heartbeat stays fresh, claims are renewed, and up to `max_checks` checks run in parallel. `norn status` and `norn inbox` show the step as `(check running)` with its age.

```text
tick N        run_check
                acquire check lease (K1)
                write ~/.norn/checks/<run_id>.json   (0600: .env.norn, step env, NORN_HOME only)
                spawn detached `norn check-run <run_id>`, hand the lease to its pid
              → returns at once
norn check-run <run_id>
                take its run's lease over itself
                runShell(command, timeout)            (timeout kills the group → fail/timeout)
                write check receipt (C5), release the lease
tick N+1..    lease live → check.running (noop), claim.renew as usual
tick after    lease gone → apply_receipts → step moves on
check-run dies → dead lease → reclaim_leases (K3) → check runs again
```

Also in this branch: the `makeZombie` test helper (`packages/adapters/test/contract/zombie.ts`) behind the K3 `ProcessPort` contract test was flaky under load. That test failed this story's check step. The helper now makes a real zombie every time. This fix is unrelated to #77.

## Evidence

- **Tick returns while the check runs**
  **Before:** In the reproduce loop (old code, 3 s check), the tick that started the check took 3478 ms ([loop-red.txt](https://github.com/PruszynskiJakub/norn-next/blob/gh-77-a-check-runs-inside-the-tick-blocking/.agents/specs/gh-77-a-check-runs-inside-the-tick-blocking/runs/_story/evidence/01M61DSFMYEVK9YR0SZQ2KY7N9/loop-red.txt)). With the dev build in a throwaway repo under `norn watch` and a `sleep 20` check, the check tick ran 14:15:44 → 14:16:05 and no other tick happened in between ([user-inbox-probes.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-77-a-check-runs-inside-the-tick-blocking/.agents/specs/gh-77-a-check-runs-inside-the-tick-blocking/runs/_story/evidence/01M61DSFMYEVK9YR0SZQ2KY7N9/user-inbox-probes.md)). On this repo, ticks ran for about 411 s (issue).
  **After:** `packages/cli/test/check-run.test.ts` asserts `tick(run_check).duration_ms < 2500` with a 3 s command. The next tick exits 0 with `check.running`. A tick past 3m gives `claim.renew` + `check.running`. Once the check-run ends, the pass receipt lands and the following tick gives `apply_receipts` → step done. This test was red on the old code (tick 3.6 s) and passes now: `5 pass, 0 fail`.

- **Heartbeat stays up while a check runs**
  **Before:** `norn inbox` showed "no heartbeat on … — run `norn watch`" while watch was running ([loop-red.txt](https://github.com/PruszynskiJakub/norn-next/blob/gh-77-a-check-runs-inside-the-tick-blocking/.agents/specs/gh-77-a-check-runs-inside-the-tick-blocking/runs/_story/evidence/01M61DSFMYEVK9YR0SZQ2KY7N9/loop-red.txt), [user-inbox-probes.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-77-a-check-runs-inside-the-tick-blocking/.agents/specs/gh-77-a-check-runs-inside-the-tick-blocking/runs/_story/evidence/01M61DSFMYEVK9YR0SZQ2KY7N9/user-inbox-probes.md)).
  **After:** Same test, 100 s into the check: `inbox.unblock` has no "no heartbeat" item (green).

- **Up to `max_checks` run in parallel; a dead check-run is started again (K1, K3)**
  **Before:** Checks decided in one tick ran one after another.
  **After:** In `check-run.test.ts`, one tick gives `run_check, run_check` in under 2.5 s, with two live check leases and two orders. After one check-run is SIGKILLed, the next tick gives `reclaim_leases, run_check` for that unit only. Both units end with `pass`.

- **`norn status` shows the check running with its age**
  **Before:** `test #1 (queued)` with the step's age.
  **After:** In `check-run.test.ts`, `norn status` prints `test#1 (check running) 1m`. The inbox `running` item is `test #1 (check running)`, aged from the lease. The inbox item also has a core test in `decide.test.ts`, which was red without the `items.ts` change.

- **Step timeout still fails with reason `timeout`**
  **Before:** A timeout gave `fail`, `reason: timeout`.
  **After:** In `check-run.test.ts`, `sleep 30` with timeout 1s gives a receipt `{ outcome: fail, exit_code: null, reason: timeout }`.

- **Fallback: "no heartbeat" not raised during a live tick and attached to the right story**
  Not changed. The issue lists this only as the fallback "until then", and the main fix removes the long tick that caused the false alarm. The item still attaches to the first held story when watch really is down. That attribution is left for its own issue.

- **No secrets written to disk**
  The order file holds only `.env.norn`, the step env and `NORN_HOME`. It is written with mode 0600, and orders that no live lease names are swept. The test checks that a process-only variable, `USER` and `PATH` are absent from the order while the command still sees them.

The full suite (1220 tests) and typecheck pass. The effect transcripts `e2e-slice-workflow` and `base-sync` were rewritten: the check spawn is now `norn check-run <ulid>`. One golden case was added for `check.running`.

## Merge danger

**Door:** Two-way. A revert brings the in-tick check back. The `~/.norn/checks/*.json` orders and the new `norn check-run` command are machine-local and only norn itself reads them. A check-run still running when the revert lands finishes, writes its receipt and releases its lease as usual.

**Blast radius:** Every check step. If this is wrong, checks would hang (shown as `check running` forever) or run twice. Known minor edges from review, none observed:
- If the tick cannot identify the child and the child dies before it takes over the lease, the lease can stay held by a long-lived `norn watch` pid.
- If `norn check-run` is SIGKILLed, the command it runs keeps going with no timeout, and K3 starts a second copy.
- `norn release`, `drop` and `workflow --to` do not stop a running check-run. It can still write a stale receipt.
