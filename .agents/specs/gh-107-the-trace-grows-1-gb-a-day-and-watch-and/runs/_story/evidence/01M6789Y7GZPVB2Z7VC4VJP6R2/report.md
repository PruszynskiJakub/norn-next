# QA gh-107 (qa #1), head f69d37a4

Setup: throwaway repos under $TMPDIR, made with (a patched copy of) scripts/trace-bench.ts: one story gh-1, its unit worktree, a live agent run, old-style day files (full-facts ticks, the run's hooks only in day files). Every command was `bun packages/cli/src/main.ts …` with NORN_HOME etc. unset and NORN_HOME_DIR isolated. The released 0.12.1 binary (~/.local/bin/norn) stood in as "the older norn".
Suite: `bun test` 1467 pass / 3 fail (suite.txt): trace-free-views B1 (flaky, see F1) and check-run "two long checks" beforeAll timeout. check-run is not in this diff, failed only while QA ran other load, and passed 3 of 3 alone. Typecheck green.

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| B1 | fail | B1-watch-unreadable.txt, B1-B2-B10-bench.json, suite-rerun.txt | Behaviour holds: status --watch refreshed 4x with all day files chmod 000; over 2.15 GB / 14 days / 420 hooks it peaked at 156 MB vs 172 MB over an empty trace (0.91x). Fails on F1 (the B1 test is flaky, 2/10) and F2 (trace-bench.ts runs the removed `cockpit`) |
| B2 | pass | B2-*.json/txt | status/status --segment print the same over chmod-000 day files; store's trace-read observer sees no day file; in-process status takes 210–219 ms full vs 213–217 ms empty |
| B3 | pass | B3-runlist-*.txt | `run list gh-1` and `--events --all` from the old and the new norn over the same trace: identical |
| B4 | pass | B4-*.json | broken `tick` / `tick.start` lines appended: `run list --events --all` is unchanged except the live run's growing durations |
| B5 | pass | report | PostToolUse in the gh-1 worktree → same line in trace/hooks/gh-1/_story.jsonl and the day file; `run list --events` shows it |
| B6 | pass | report | the same hook in the main checkout → day file size unchanged, no new hook file or line |
| B7 | pass | B7.txt | with the unit's run removed from state, a SessionStart fact with no run_id → a line in gh-1's hook file |
| B8 | pass | B8-*.json | a tick with every day file chmod 200 (write-only) succeeds, its story chunk is the same one (hooks included), and `why` replays it |
| B9 | pass | B9.txt | with day files write-only: Stop 1–3 blocked, 4–5 allowed (MAX_STOP_BLOCKS 3); the count comes from the unit file |
| B10 | pass | B10-*.json/txt | brief succeeds with write-only day files (it only appends a briefing event); observer: no day file; 142–243 ms full vs 146–309 ms empty |
| B11 | pass | B11-tick1.json | the first tick copied the 70 day-file hook lines (72 lines in all, 72 unique ids); ticks 2 and 3 copied nothing |
| B12 | pass | B12.txt | hook file cut to 31 of 78 lines, backfill.json done=[] → the next tick restores 78 lines / 78 unique ids, done=[gh-1]; the one after adds nothing |
| B13 | pass | B13-bytes.txt | quiet ticks: +1518 B to the day file, +0 B chunks |
| B14 | pass | B14-new-chunks.txt | 72 hooks = a 64 block + an 8 block; one more hook → only a new 9-fact block and the story chunk; the 64 block is not rewritten |
| B15 | pass | B21-why.json | a tick line naming a missing chunk is refused, never replayed; extra (duplicate) chunks are harmless (B16); the crash-ordering fsync itself is covered by the S2 suite, not killed by hand here |
| B16 | pass | B16-*.txt/json | duplicated chunk lines: replay matches; chunks file emptied under a running `watch` → its next tick rewrote all 5 chunks and the latest tick replays |
| B17 | pass | B17-why.json, B19-replay-all.txt | `run view --why --tick` on chunked ticks: replay.matches/all_match true |
| B18 | pass | B35-B18.txt | a full-facts tick written by 0.12.1 replays with the new norn (all_match true) |
| B19 | pass | B19-replay-all.txt | only 2026-10-30.jsonl + .chunks.jsonl in an empty trace dir → all 8 chunked ticks of the day replay |
| B20 | pass | B20.txt | ulid 40 days old → exit 3 tick_pruned "older than the trace retained (14d)", do-instead `norn run list gh-1`; a missing tick within the window → no_tick |
| B21 | pass | B21-why.json | a chunk line removed → exit 4 trace_corrupt naming the hash and the chunks file |
| B22 | pass | B22.txt | harvest of recovery and base-sync on origin/main vs the branch: names differ only by the new `config.trace.retain`; with it added, recovery 30/30 names and decisions equal; base-sync 72/113, the same as main against itself run to run (72/113) |
| B23 | pass | B23-*.json/txt | no trace.retain → config get shows 14d built-in; tidy prunes days older than 14 days |
| B24 | pass | B24-tidy30.json | trace.retain 14d plus `--retain 30d` → only the 10 days older than 30 days pruned |
| B25 | pass | B25-B26-B33.txt | `--retain 7d` and trace.retain 7d → exit 3 retain_too_short naming 14d; the trace is unchanged |
| B26 | pass | B25-B26-B33.txt | `--retain soon` → exit 2 retain_invalid "expected a form like 14d"; trace.retain soon → exit 3; the trace is unchanged |
| B27 | pass | B23-B27-B32.txt | days 40..15 ago pruned in pairs (26 in all), 10-16..10-30 kept |
| B28 | pass | B24-tidy30.json | gh-3's hook file (30 days old, no run) pruned; gh-1's (live, backdated 20 days) kept |
| B29 | pass | B23-tidy14.json | briefings+transcripts of a run 20 days old pruned; a run 1 day old kept |
| B30 | pass | B23-B27-B32.txt | the live run's briefings/transcripts/hook file backdated 20 days are kept; workflows/old.yaml 60 days old is kept |
| B31 | pass | B31-dry.json | --dry-run lists day pairs, hook files and runs, each with bytes plus a total; file list identical afterwards |
| B32 | pass | B23-B27-B32.txt | second tidy: days/hook_files/runs empty, bytes 0 |
| B33 | pass | B25-B26-B33.txt | doctor hint "trace keeps 26 days (522.9 KB) beyond trace.retain 14d — run `norn tidy`"; with trace.retain 7d also a warning |
| B34 | pass | B34.txt | a 40-day-old day pair and a 30-day-old hook file survive `watch --max-ticks 3` and a `tick` |
| B35 | pass | B35-B18.txt | 0.12.1 after chunked ticks: `status`, `status --history`, `run list`, watch/tick all work; its `why` on a chunked tick → replay_failed; new norn then replays both the old norn's full tick and the chunked tick |

Notes for a person:
- The diff to main has 1514 files, 1455 of them under this story's runs/: the slice 03 evidence (`runs/03-…/evidence/01M66V5PAXYCZQ9QVM14ZHS7H2/base/…`) commits a whole copy of the repo.
- B22's "same case names" holds only once `trace.retain`, now part of every case's config, is counted. The corpus is not rewritten and golden.test.ts is green.
