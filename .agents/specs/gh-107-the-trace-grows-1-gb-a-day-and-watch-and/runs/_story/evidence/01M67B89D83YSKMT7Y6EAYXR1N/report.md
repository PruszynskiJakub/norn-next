# QA gh-107 (qa #2), head 40f18f6c

Product source (packages/*/src, assets) is byte-identical to qa#1's head f69d37a4; only packages/cli/test/trace-free-views.test.ts and scripts/trace-bench.ts changed. Every criterion was checked again on this head anyway.
Setup: throwaway repos made with `scripts/trace-bench.ts --keep` (one story gh-1, its unit worktree, a live agent run, old-style full-facts day files, the run's hooks only in the day files). Every command was `bun packages/cli/src/main.ts …` with NORN_* unset and NORN_HOME_DIR isolated; the released 0.12.1 binary stood in for the older norn. Drivers: qa1.sh, qa2.sh, qa3.sh (logs qa1.log, qa2.log, qa3.log).
Suite: `bun test` 1469 pass / 0 fail (suite.txt). Typecheck green (typecheck.txt).

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| B1 | pass | B1-B2-B10-bench.json, B1-watch-unreadable.txt, B1-test-10x.txt | the fixed bench drives `status --watch` over 2.15 GB / 14 days / 420 hooks: 59 samples, peak 134 MB vs 175 MB on an empty trace (0.77x); a rerun gave 0.99x. With every day file chmod 000, watch refreshed for 6 s and exited 0 with no error. The B1 test passed 10 of 10 runs on its own |
| B2 | pass | B2-* | status --json, status (minus a one-time notice), status --segment and story list print the same with day files readable, chmod 000 and moved away. Over 2 GB, 7 alternating rounds: status median 487 ms on the full trace vs 499 ms empty |
| B3 | pass | B3-* | `run list gh-1` and `--events --all`, plus `status --history`: 0.12.1 and the new norn print the same over the same trace |
| B4 | pass | B4-* | broken `tick`/`tick.start` lines appended: the new norn's output is unchanged and the lines are not reported. 0.12.1's CLI does not report them either, so the reader-level difference shows only in the slice 01 test |
| B5 | pass | B5-line.json | PostToolUse in the worktree: +1 line each in hooks/gh-1/_story.jsonl and the day file, the same line (by id); `run list --events --json` shows it |
| B6 | pass | qa2.log | the same hook in the main checkout: day file +0 B, no new hook file or line |
| B7 | pass | B7-line.json | run removed from state: SessionStart with run_id null is written to gh-1's hook file |
| B8 | pass | B8-* | tick with every day file chmod 200 succeeds with the same decisions as a readable tick; why replays it |
| B9 | pass | B9.txt | day files write-only: Stop hooks 1–3 are blocked, 4–5 allowed |
| B10 | pass | B10-*, B2-B10-timing-alternating.txt | brief succeeds with write-only day files, and its output matches the readable case apart from the new briefing path. Over 2 GB, alternating rounds: brief median 385 ms full vs 383 ms empty |
| B11 | pass | qa1.log | 100 day-file hooks → hook file 100 lines / 100 unique ids, backfill done=[gh-1]; 2nd tick copies nothing |
| B12 | pass | B12.txt | hook file cut to 32 lines (+1 hook fired meanwhile), done=[] → next tick: 109 lines / 109 unique ids, done=[gh-1]; the one after adds nothing |
| B13 | pass | B13-bytes.txt | two quiet ticks: +3036 B day file, +0 B chunks |
| B14 | pass | B14-* | 100 hooks = a 64-fact block + a 36-fact block; one more hook → 2 new chunk lines (a 37-fact block and the story chunk); the 64-fact block is not rewritten |
| B15 | pass | B15-why.txt, B21-why.json | an orphan chunk appended without a tick line: earlier ticks replay, and status works. A tick naming a missing chunk is refused, never replayed |
| B16 | pass | B16-* | chunk lines duplicated: replay matches. Chunks file emptied under a running watch: the next tick rewrote 5 chunks and the latest tick replays |
| B17 | pass | B17-why-all.txt | every chunked tick: replay matches / all_match true |
| B18 | pass | qa2.log | a full-facts tick written by 0.12.1 replays with the new norn (all_match true) |
| B19 | pass | B19-replay-all.txt | only today's day file and chunks file in the trace folder: all 10 chunked ticks replay |
| B20 | pass | B20.txt | ulid 40 days old → exit 3 tick_pruned "older than the trace retained (14d)", do-instead `norn run list gh-1` |
| B21 | pass | B21-why.json | one chunk line removed → exit 4 trace_corrupt, naming the hash and the chunks file |
| B22 | pass | B22.txt | recovery.test.ts harvest, origin/main c3aa7312 vs this branch: 30/30 cases have equal names and decisions once config.trace.retain is set aside |
| B23 | pass | B23-* | no config → trace.retain 14d (built-in); tidy prunes days older than 14 days |
| B24 | pass | B24-tidy30.json | trace.retain 14d plus --retain 30d → only the 10 days older than 30 days pruned |
| B25 | pass | B25-B26.txt | --retain 7d and trace.retain 7d → exit 3 retain_too_short naming 14d; trace unchanged |
| B26 | pass | B25-B26.txt | --retain soon → exit 2 retain_invalid "expected a form like 14d"; trace.retain soon → exit 3; trace unchanged |
| B27 | pass | B23/B24 tidy json | of 41 day pairs, 26 pruned (10 at 30d, then 16 at 14d); 10-16..10-30 kept |
| B28 | pass | B24-tidy30.json, tidy-after.txt | gh-3's hook file (30 days old, no run) pruned; gh-1's (live run, backdated 20 days) kept |
| B29 | pass | B23-tidy14.json | the 20-day-old run's briefings and transcripts pruned; the 1-day-old run kept |
| B30 | pass | tidy-after.txt | the live run's briefings, transcripts and hook file (backdated 20 days) kept; workflows/old.yaml (60 days old) kept |
| B31 | pass | B31-dry.json | --dry-run lists day pairs, hook files and runs, each with bytes, plus a total; file list identical afterwards |
| B32 | pass | B32-tidy2.json | second tidy: days, hook files and runs empty, bytes 0 |
| B33 | pass | B33-hint.txt | doctor: "trace keeps 26 days (3.8 MB) beyond trace.retain 14d — run `norn tidy` …"; after tidy, no hint |
| B34 | pass | B34.txt | a 40-day-old day pair and a 30-day-old hook file survive `watch --max-ticks 3` and a tick |
| B35 | pass | B35-*, qa2.log | 0.12.1 after chunked ticks: status, status --history, run list, tick and watch exit 0; its why on a chunked tick → replay_failed (exit 3); its tick is full facts; the new norn then replays both |

Notes:
- B22's "same case names" holds only once `trace.retain`, now in every case's config, is set aside (as in qa#1). The corpus is not rewritten and golden.test.ts is green.
- The first bench's status/brief ratios (1.49x/3.02x) were measured while the full suite and another session's suite loaded the CPU, with full and empty measured minutes apart. The alternating rounds above are the timing evidence.
