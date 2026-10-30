## Summary

`norn watch`, the cockpit and every tick stop paying for the whole trace on each cycle, and the trace on disk stops growing quadratically: the views that need no timeline read no day file, hook facts get a per-unit hook file, a tick stores its facts as content-addressed chunks, and `norn tidy` prunes the trace past `trace.retain` (default and minimum `14d`).

```text
.agents/norn/trace/
  2026-10-30.jsonl            # day file: tick lines keep decisions inline; facts are a "$chunked": 1 skeleton
  2026-10-30.chunks.jsonl     # NEW: {"h": sha256, "v": value}, each chunk once a day, fsynced before the tick line naming it
  hooks/
    gh-9/_story.jsonl         # NEW: the unit's hook facts (also still in the day file); ticks, `norn hook`, `brief` read only this
    gh-9/01.jsonl             # NEW: a slice unit's hook file
    backfill.json             # NEW: one-time copy of live runs' hook lines from the day files (since, done)
```

```diff
 tick
   observe facts
-    read every day file since the oldest live run began → hook facts
+    read the hook files of units with a live run (or changed within limits.stalled)
   decide
-  append tick line with the full facts (~650 KB)
+  append the chunks not yet written today (story facts, machine, issues, config, workflows,
+    each run's hooks in fixed 64-fact blocks), then a tick line naming them (two quiet ticks: ~3 KB together)

 cockpit / status / status --segment / inbox
-  loadProjectView reads 14 days of trace for timelines
+  loadProjectView reads no day file; timelines come from loadTimelines / loadTraceView on request
```

The PRD is amended in the same diff: A2, A4, O4, O5, new O7 (retention), X1, X4.

## Evidence

All verdicts from qa#2 on head `40f18f6c` ([report](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/report.md), [criteria](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/criteria.json)): every command run as `bun packages/cli/src/main.ts` in throwaway repos made by `scripts/trace-bench.ts` (2.15 GB, 14 day files, one live run with 420 hook facts), with the released 0.12.1 binary as the older norn. `bun test` 1469 pass / 0 fail ([suite](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/suite.txt)), typecheck green ([typecheck](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/typecheck.txt)).

### Reading the trace only on demand

- **B1** cockpit reads no day file, footprint flat
  **Before:** 7–20 GB, swinging by gigabytes between samples.
  **After:** `status --watch` over the 2 GB trace: 59 samples, peak 134 MB vs 175 MB on an empty trace (0.77x; a rerun 0.99x); with every day file `chmod 000` it refreshes for 6 s and exits 0. Test asserts "cockpit refresh opens no day file", passed 10/10 alone. [bench](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B1-B2-B10-bench.json), [unreadable](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B1-watch-unreadable.txt), [10x](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B1-test-10x.txt)
- **B2** `status`, `--segment`, `inbox` read no day file
  **Before:** each load read 14 days of trace.
  **After:** identical output with day files readable, `chmod 000` and moved away; 7 alternating rounds over 2 GB: median 487 ms full vs 499 ms empty. [status](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B2-status-unreadable.json), [segment](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B2-segment-unreadable.txt), [timing](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B2-B10-timing-alternating.txt)
- **B3** same timeline entries over 14 days
  **Before:** timelines built inside `loadProjectView`.
  **After:** `run list gh-1`, `--events --all` and `status --history` print the same from 0.12.1 and the new norn over one trace. [diff](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B3-events.diff), [old](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B3-runlist-old.txt) / [new](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B3-runlist-new.txt)
- **B4** readers skip unshown event types unparsed
  **Before:** every line parsed.
  **After:** broken `tick` / `tick.start` lines appended: output unchanged, not reported. 0.12.1's CLI did not report them either, so the difference is shown only by slice 01's reader test. [old](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B4-events-broken-old.txt) / [new](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B4-events-broken-new.txt)

### Hook facts per unit

- **B5** hook in a unit worktree → unit hook file + day file
  **Before:** day file only.
  **After:** `PostToolUse` → one line (same id) in `hooks/gh-1/_story.jsonl` and the day file; `run list --events` shows it. [line](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B5-line.json)
- **B6** hook outside a unit worktree stays a no-op
  **Before:** no-op (A3). **After:** day file +0 B, no hook file. [qa2.log](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/qa2.log)
- **B7** hook without a run id lands in the unit's hook file
  **Before:** did not exist. **After:** `SessionStart` with `run_id: null` written to gh-1's hook file. [line](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B7-line.json)
- **B8** a tick reads only qualifying hook files
  **Before:** every day since the oldest live run began.
  **After:** with every day file write-only the tick succeeds with the same decisions as a readable tick, and `why` replays it. [readable](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B8-tick-readable.json) / [write-only](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B8-tick-writeonly.json)
- **B9** blocked-hook count from the unit's hook file
  **Before:** counted from the day files. **After:** day files write-only: `Stop` 1–3 blocked, 4–5 allowed, as before. [B9](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B9.txt)
- **B10** `brief` reads only its unit's hook file
  **Before:** read the day files.
  **After:** succeeds with write-only day files, same output; over 2 GB median 385 ms full vs 383 ms empty. [write-only](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B10-brief-writeonly.json), [timing](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B2-B10-timing-alternating.txt)
- **B11** first tick backfills live runs' hooks once
  **Before:** did not exist. **After:** 100 day-file hooks → hook file 100 lines / 100 ids, `done=[gh-1]`; the 2nd tick copies nothing. [tick1](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B11-tick1.json), [tick2](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B11-tick2.json)
- **B12** interrupted backfill finishes, deduplicated
  **Before:** did not exist. **After:** hook file cut to 32 lines + 1 new hook, `done=[]` → next tick: 109 lines / 109 unique ids; the one after adds nothing. [B12](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B12.txt)

### Facts stored as chunks

- **B13** a quiet tick writes under 5 KB
  **Before:** ~650 KB per tick.
  **After:** two quiet ticks: +3,036 B to the day file, +0 B chunks. [bytes](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B13-bytes.txt)
- **B14** hooks in fixed 64-fact blocks, written once
  **Before:** a run's whole hook list re-recorded each tick.
  **After:** 100 hooks = a 64 block + a 36 block; one more hook → 2 new chunk lines (a 37 block and the story chunk); the 64 block is not rewritten. [chunks](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B14-new-chunks.txt)
- **B15** no tick line names an unwritten chunk
  **After:** an orphan chunk without a tick line: earlier ticks replay; a tick naming a missing chunk is refused, never replayed. [why](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B15-why.txt)
- **B16** lost or stale written-chunks list is harmless
  **After:** duplicated chunk lines replay the same; chunks file emptied under a running watch → the next tick rewrote 5 chunks and replays. [why](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B16-why-after-stale.txt)
- **B17** `why` replays a chunked tick exactly
  **After:** every chunked tick: `all_match: true`. [why](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B17-why-all.txt)
- **B18** `why` on a pre-upgrade tick
  **After:** a full-facts tick written by 0.12.1 replays with `all_match: true`. [qa2.log](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/qa2.log)
- **B19** one day's two files replay that day
  **After:** only today's day + chunks file in the trace folder: all 10 chunked ticks replay. [replay](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B19-replay-all.txt)
- **B20** `why` on a pruned day refuses
  **Before:** did not exist. **After:** 40-day-old tick → exit 3 `tick_pruned` "older than the trace retained (14d)". [B20](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B20.txt)
- **B21** missing chunk → corrupt entry, no replay
  **After:** one chunk line removed → exit 4 `trace_corrupt` naming the hash and chunks file. [why](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B21-why.json)
- **B22** golden harvest reads chunked ticks
  **After:** `recovery.test.ts` harvest on main `c3aa7312` vs this branch: 30/30 equal names and decisions **once `config.trace.retain` is set aside**: it is now in every case's config, so a fresh harvest would name cases differently. The corpus is not rewritten and `golden.test.ts` is green. [B22](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B22.txt)

### Pruning

- **B23** `trace.retain`, default `14d`
  **Before:** never pruned. **After:** no config → `14d`; tidy prunes days older than 14. [config](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B23-config.json), [tidy](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B23-tidy14.json)
- **B24** `--retain` overrides config
  **After:** `trace.retain: 14d` + `--retain 30d` → only the 10 days older than 30 pruned. [tidy](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B24-tidy30.json)
- **B25** window under 14d refused
  **After:** `--retain 7d` and `trace.retain: 7d` → exit 3 `retain_too_short` naming `14d`; nothing deleted. [B25–B26](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B25-B26.txt)
- **B26** non-duration refused
  **After:** `--retain soon` → exit 2 `retain_invalid` "expected a form like 14d"; `trace.retain: soon` → exit 3; nothing deleted. [B25–B26](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B25-B26.txt)
- **B27** day pairs past the window deleted
  **After:** of 41 day pairs, 26 pruned (10 at 30d, 16 more at 14d); the last 14 days kept. [14d](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B23-tidy14.json), [30d](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B24-tidy30.json)
- **B28** stale hook files deleted
  **After:** gh-3's 30-day-old hook file pruned; gh-1's (live run, backdated 20 days) kept. [after](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/tidy-after.txt)
- **B29** old runs' briefings and transcripts deleted
  **After:** a 20-day-old ended run's pruned, a 1-day-old's kept. [tidy](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B23-tidy14.json)
- **B30** nothing a live run needs, no workflow
  **After:** the live run's briefings, transcripts and hook file (backdated 20 days) kept; a 60-day-old `workflows/old.yaml` kept. [before](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/tidy-before.txt) / [after](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/tidy-after.txt)
- **B31** `--dry-run` lists with bytes, deletes nothing
  **After:** day pairs, hook files and runs each with bytes and a total; file list identical afterwards. [dry](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B31-dry.md)
- **B32** second tidy prunes nothing
  **After:** days, hook files and runs empty, bytes 0. [tidy2](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B32-tidy2.json)
- **B33** doctor hints past the window
  **After:** "trace keeps 26 days (3.8 MB) beyond trace.retain 14d — run `norn tidy`"; no hint after tidy. [hint](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B33-hint.txt)
- **B34** watch and ticks never prune
  **After:** a 40-day-old day pair and a 30-day-old hook file survive `watch --max-ticks 3` and a tick. [B34](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B34.txt)

### Upgrade and downgrade

- **B35** the older norn keeps working after a downgrade
  **After:** 0.12.1 after chunked ticks: `status`, `status --history`, `run list`, `tick`, `watch` exit 0; its `why` on a chunked tick → `replay_failed` (exit 3); its own tick writes full facts, which the new norn then replays alongside the chunked ones. [old why](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B35-old-why.json), [old tick](https://github.com/PruszynskiJakub/norn-next/blob/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/.agents/specs/gh-107-the-trace-grows-1-gb-a-day-and-watch-and/runs/_story/evidence/01M67B89D83YSKMT7Y6EAYXR1N/B35-old-tick.json)

Not asserted in the suite, by plan: B1's footprint and B2/B10's timing are QA benchmark numbers on one machine, not CI.

## Merge danger

**Door:** one-way: after a day on this version, `norn why` from a reinstalled older norn cannot replay the chunked ticks (B35), and new `hooks/` and `*.chunks.jsonl` files stay behind; `norn tidy` deleting old trace is irreversible by design. Everything else (watch, ticks, status) keeps working on a downgrade.

**Blast radius:** this machine's trace: every tick now writes in the new format and the first tick backfills hook files, so a bug shows as `why` refusing (`trace_corrupt`) or a tick deciding on missing hook facts (a stalled or blocked-hook verdict off by the facts a hook file lacks). `trace.retain` joins every resolved config, which changes golden case names on the next harvest (B22). Repo size: 1,614 of the 1,673 changed files are QA evidence under `runs/`, 1,015 of them a copy of the base checkout in slice 03's evidence.
