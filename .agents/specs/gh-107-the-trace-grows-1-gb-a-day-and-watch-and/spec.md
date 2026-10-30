---
id: gh-107
slug: the-trace-grows-1-gb-a-day-and-watch-and
provider: gh
number: 107
url: https://github.com/PruszynskiJakub/norn-next/issues/107
title: The trace grows ~1 GB a day and watch and the cockpit read it whole every cycle, so they climb to 8–21 GB of memory
assignee: PruszynskiJakub
labels:
  - friction
  - norn
workflow: triage
status: new
intake_at: 2026-10-30T10:30:20.759Z
body_hash: 4aec03ac7d6c0aadb80fd12805af7dd19fa71dea889e32579bc397d67dcb27e2
---

## Observed

After a day of use, `norn cockpit` sat at a 20 GB footprint and `norn watch --human` at 6 GB (`footprint -p <pid>`; most of it is tagged `IOAccelerator`, which is mimalloc's VM tag 100, i.e. Bun's native heap). RSS swings by gigabytes between 20 s samples (cockpit 7.1 GB → 356 MB → 174 MB): not a leak, but gigabytes allocated and freed on every loop.

`.agents/norn/trace/` is 2.0 GB: `2026-10-29.jsonl` 1.0 GB, `2026-10-30.jsonl` 674 MB by 09:30. Measured on 2026-10-30's 1,045 ticks:

- each `tick` line is ~650 KB, almost all `facts`; facts total 655 MB for the day
- 350 MB of that is `stories[].units[].run.hooks`: every tick re-records every hook fact of each running run, so a long run grows the trace quadratically (gh-71's run: 416 hooks, ~340 KB per tick). Only 454 KB of those hook facts are distinct (~770× repetition)
- the same facts stored content-addressed (one chunk per unit and per story, each hook fact one chunk) come to ~29 MB
- 7 of the 1,045 ticks decided anything but `noop`/`claim`

The readers then load whole day files on each cycle:

- cockpit: `projectView` every 5 s → `loadProjectView` → `readTrace` over 14 days (today: every file, 2 GB): read whole, split, `JSON.parse` and schema-validate every line, keep all events
- every tick (watch, cron, by hand) and every view load: `loadLocalFacts` → `readHookFacts` reads every day file since the oldest live run began, whole, to pick out the `{"type":"hook"` lines
- every `norn hook` call: `blockedHookCount` reads every day file since its run began, whole

## Wanted

Memory and per-cycle work of watch, the cockpit, ticks and hooks stay bounded by what changed, not by how long norn has run; the trace on disk stays bounded; `norn why` still replays exactly (O4, O5). Four parts, each shippable and measurable on its own:

1. **Hook facts by run.** `norn hook` also appends its fact to `trace/hooks/<run_id>.jsonl` (a fact without `run_id` keeps only the day file). `readHookFacts` reads the live runs' files; `blockedHookCount` reads one. Reads that only need a few event types stream line by line and test the `{"type":"…"` prefix before `JSON.parse`.
2. **Facts stored by content hash.** A tick line keeps its decisions and a tree of hashes; the chunks go to `trace/facts/<sha>.json`, written once (atomic, skip when present) — the pattern `workflows/<hash>.yaml` already uses. `why`, `findTick`, `lastTickFor` and the golden harvest rebuild the facts from the hashes. ~22× less per day, and no more quadratic hook growth.
3. **Incremental reads in long-lived processes.** Day files are append-only, so `(inode, size, mtime)` is an exact etag: the cockpit and watch keep `{inode, offset, events}` per day file and read only the bytes after `offset`; a new inode or a smaller size reads the file again. The cockpit also skips rebuilding the view when nothing it reads changed (`heartbeat.json` `last_tick_at`, trace sizes, `runs/` state mtimes).
4. **Retention.** `trace.retain` (default 14d, the view's window) deletes older day files and, with part 2, the chunks no kept tick references (mark from the kept ticks, sweep the rest). A backstop for disk, not a fix for reads.

Considered and left out: a tick stored as a diff of the previous one (replay then depends on a chain; one bad line breaks every later tick); quiet ticks without facts (changes O4, and part 2 already makes them cheap); gzip of old days (saves disk, not reads).

## Repro

Run `norn watch` and `norn cockpit` for a day with one long-running agent step, then:

```sh
ls -la .agents/norn/trace/*.jsonl
ps -o pid,etime,rss,command -p "$(pgrep -f 'norn cockpit')","$(pgrep -f 'norn watch')"
footprint -p "$(pgrep -f 'norn cockpit')" | head -12
```

Size of a tick line and of its hook facts:

```sh
grep '^{"type":"tick",' .agents/norn/trace/$(date -u +%F).jsonl | tail -1 | wc -c
```

## Where

- `packages/store/src/trace.ts:31` `appendTrace` (one line per event, full facts in `tick`)
- `packages/cli/src/runtime/tick.ts:94` (writes the tick record with the full `obs.facts`); `:63` `replayInputs` (the one place a tick line becomes decide's inputs again: where part 2 rebuilds facts)
- `packages/store/src/trace.ts:122` `readTrace` (whole file, parse + validate every line)
- `packages/store/src/trace.ts:200` `readHookFacts`, `:227` `blockedHookCount` (whole files)
- `packages/store/src/local-facts.ts:116` (calls `readHookFacts` on every tick and view load)
- `packages/view/src/load.ts:73,264` (`TRACE_WINDOW_MS` 14 days, read on every view load)
- `packages/cli/src/commands/cockpit.ts:160` (`projectView` every interval, default 5 s)
- `packages/cli/src/commands/hook.ts:87` (`blockedHookCount` on every hook)

## PRD

O4 (one trace record per tick with the facts snapshot — kept, as a reference), O5 (`why` replays the recorded snapshot), A2/A4 (hook facts, blocked-hook count), B4/C4 (side files under `trace/`, the precedent for chunks), H2, X1 (view reads), X4 (core replayed from recorded traces: the golden harvest reads tick facts), S1 (atomic chunk writes).
