# AC4 (B1, B2) — benchmark on a synthetic ~2 GB trace

`bun scripts/trace-bench.ts` (defaults: 14 day files, 2,148,854,794 bytes, 420 hook facts of one live run, cockpit refreshing every 5 s for 60 s, status median of 5). Raw: AC4-bench.json (branch), AC4-bench-base.json (same script, `--norn "bun <base tree>/packages/cli/src/main.ts"`, base e83f5f1e).

| | branch full | branch empty | ratio | base full | base empty | base ratio |
|---|---|---|---|---|---|---|
| status median | 424 ms | 423 ms | **1.00** | 2247 ms | 419 ms | 5.36 |
| brief | 342 ms | 392 ms | 0.87 | | | 0.64 |
| cockpit peak RSS | 352 MB | 167 MB | **2.10** | 8.33 GB | 158 MB | 52.6 |
| cockpit last RSS | 235 MB | 73 MB | | | | |

- status: about the same time over the full and empty trace → meets AC4's status half.
- cockpit: peak RSS 2.1× the empty-trace footprint → AC4's "within ~10%" is **not met** on this head (implement measured 3.25× on its run). It fell from 52.6× on the base.
- Cause: with a live run, the view still opens today's day file (~150 MB here) through local facts' hook read (readHookFacts, window from the live run's start). Observed with the read observer on a small bench repo: `norn status --json` opens exactly `2026-10-30.jsonl` and nothing else (see AC2.md). Per-unit hook files are slice 04 (B8), out of this slice's scope ("Out: hook files (04)").

Benchmark defect (affects reuse by 04's QA): the synthetic hook facts carry `input: {command}`, which HookFact does not allow (`unknown property 'input'`; HookFact has `command`). Every one of the 420 hook lines fails validation (seen as 51 errors in the small-repo run, 50 of them hook lines), so the live run's hooks are never actually loaded as facts. `scripts/trace-bench.ts` hooks map: should use `command:` instead of `input: { command }`.

## Person's ruling (qa#1, answered in the pane)

"Pass AC4 here: status is met and cockpit went from 52.6x to 2.10x. The rest is the hook scan of today's day file, which slice 04 (B8) removes. Fix the bench's hook facts to a valid HookFact shape so they load. Note in handoff that slice 04's QA owns cockpit ≤ ~10% over empty."

## Bench fixed, rerun (AC4-bench-fixed.json)

`scripts/trace-bench.ts`: hook facts now carry `command` (valid HookFact), and the `as HookFact` cast is gone so the type checker checks the shape. Check on a small repo: readTrace sees 50 hook events and 0 errors (was 50 errors); typecheck green.

Full-size rerun (2,152,125,250 bytes, 14 days, 420 valid hooks):

| | full | empty | ratio |
|---|---|---|---|
| status median | 445 ms | 446 ms | **1.00** |
| brief | 324 ms | 377 ms | 0.86 |
| cockpit peak RSS | 464 MB | 168 MB | **2.77** |

With the hooks now loading, the cockpit's peak ratio is 2.77× (2.10× with the invalid hooks), still far below the base's 52.6×. The remaining gap is the live run's hook scan of today's day file (slice 04, B8). Per the ruling, slice 04's QA owns cockpit ≤ ~10% over empty.
