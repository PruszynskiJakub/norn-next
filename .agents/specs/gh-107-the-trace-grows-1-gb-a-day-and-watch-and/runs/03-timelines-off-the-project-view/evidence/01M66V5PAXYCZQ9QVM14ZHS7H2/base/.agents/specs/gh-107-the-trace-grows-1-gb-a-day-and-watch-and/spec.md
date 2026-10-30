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
workflow: story
status: active
intake_at: 2026-10-30T10:30:20.759Z
body_hash: 4aec03ac7d6c0aadb80fd12805af7dd19fa71dea889e32579bc397d67dcb27e2
---

# The trace grows ~1 GB a day and watch and the cockpit read it whole every cycle, so they climb to 8–21 GB of memory

## Problem

A person who leaves `norn watch` and `norn cockpit` running for a day with one long agent step finds them at 6 GB and 20 GB of memory, swinging by gigabytes between samples, and the machine slowing down. The trace on disk grows by about 1 GB a day and is never pruned.

Two things cause it. Every tick records the whole facts snapshot again (~650 KB a line), including every hook fact of each live run, so a long run makes the trace grow quadratically; on a measured day only 7 of 1,045 ticks decided anything but a no-op or a claim renewal. And the readers load whole day files on every cycle: the cockpit reads 14 days of trace every 5 seconds to build its view, every tick and view load reads every day since the oldest live run began to find hook facts, and every `norn hook` call does the same for its run. The longer norn has run, the more each cycle costs, and today the person's only remedy is to delete trace files by hand and lose `norn why` for those ticks.

## Solution

After this story the cost of each cycle follows what changed, not how long norn has run, and the trace on disk stays bounded once the person tidies.

- The cockpit, `status`, `status --segment` and `inbox` never read the trace. Only the views that show timelines read it, and readers skip lines of event types they did not ask for without parsing them.
- Each hook fact fired in a unit worktree also lands in that unit's own hook file. Ticks, `norn hook` and `brief` read only the hook files of the units they concern. The first tick of the new version fills those files once from the existing day files.
- A tick line keeps its decisions but stores its facts as chunks addressed by content hash, written once into a chunks file kept beside the day file. A quiet tick then writes a few kilobytes instead of ~650 KB, and a run's hook facts are stored once, not once per tick. `norn why` still replays every tick exactly, old and new.
- `norn tidy` prunes the trace older than a retention window (`trace.retain`, default 14 days, at least 14 days), never anything a live run needs. `norn doctor` says when the trace holds more than the window.

The trace stays in JSONL day files. Each slice amends the PRD ids it changes in the same diff (X1; A2/A4; O4/O5/X4; a new retention rule). Downgrading to an older release is a one-way door, with no compatibility mode: see B35.

## Behaviour

Measured where a size or a footprint is named on a synthetic trace like the reported one: 14 day files totalling ~2 GB, one live run with 400+ hook facts.

### Reading the trace only on demand

- B1 As a person running `norn cockpit`, I want it to read no trace day file, so that its memory does not grow with the trace.
  Example: with the 2 GB trace, the cockpit refreshes every 5 s for a minute; no day file is opened, and its footprint stays within ~10% of its footprint with an empty trace (against 7–20 GB today).
- B2 As a person running `norn status`, `norn status --segment` or `norn inbox`, I want them to read no trace day file, so that they answer at the same speed however large the trace is.
  Example: `norn status` with the 2 GB trace and with an empty trace prints the same thing in about the same time, and opens no day file.
- B3 As a front end reading timelines through `@norn/view` (X1), or a person reading `norn trace`, I want the same timeline entries over the 14-day window as before, so that nothing is lost by reading the trace less often. The project view itself (`loadProjectView`) carries no timeline; a caller that wants one asks for it.
  Example: the same repo before and after the change shows the same timeline entries over the 14-day window.
- B4 As a person reading `norn trace`, inbox history or a timeline, I want the same output as before, produced without parsing lines of event types the command does not show.
  Example: `norn trace gh-9` prints the same events as before; the tick lines it does not need are skipped by their type without being parsed, so a broken line of a type the command does not show is no longer reported by it.

### Hook facts per unit

- B5 As an agent whose hook fires in a unit worktree, I want the fact appended to that unit's own hook file as well as to the day file, so that readers of that unit's hooks need not read the day files, and `norn trace` and the timelines still show it.
  Example: a `PostToolUse` hook in the gh-9 worktree → one line in gh-9's hook file and the same line in today's day file; `norn trace gh-9` shows it.
- B6 As an agent whose hook fires outside any unit worktree, I want `norn hook` to stay a no-op, as today (A3): no day-file line and no hook file.
  Example: a hook fired in the repo's main checkout → nothing traced; no hook file is created.
- B7 As an agent in a unit worktree, I want hook facts that carry no run id to go to the unit's hook file too, since the unit is found by the worktree, not by the run.
  Example: a session-start hook without a run id in gh-9's worktree → a line in gh-9's hook file.
- B8 As a person running ticks (watch, cron or by hand), I want each tick to read only the hook files of units with a live run (or an unknown launch, R5.1), or whose hook file changed within `limits.stalled`, so that its cost does not grow with the day files.
  Example: with the 2 GB trace and one live run on gh-9, a tick reads gh-9's hook file and no day file to collect hook facts, and decides the same as before.
- B9 As an agent whose hook is counted against the blocked-hook limit (A4), I want `norn hook` to count from its unit's hook file only, with the same count as before.
  Example: the 6th blocked hook of a run on gh-9 gets the same answer as before, and the day files are not read.
- B10 As an agent running `norn brief`, I want it to read only its own unit's hook file for hook facts.
  Example: `norn brief` in gh-9 with the 2 GB trace answers in about the same time as with an empty trace.
- B11 As a person upgrading norn while runs are live, I want the first tick of the new version to copy the hook lines of live units from the day files into their hook files once, so that no hook fact of a live run is lost.
  Example: gh-9 has a live run with 400 hook lines in yesterday's and today's day files → after the first tick, gh-9's hook file holds those 400 lines; the second tick copies nothing.
- B12 As a person whose upgrade tick was interrupted or overlapped with new hooks, I want the backfill to be deduplicated by event id and to finish on a later tick, so that no hook fact is copied twice or missed.
  Example: a hook fires into gh-9's hook file while the backfill runs, then the tick crashes → the next tick completes the backfill; each event id appears once in gh-9's hook file.

### Facts stored as chunks

- B13 As a person whose watch runs all day, I want a quiet tick (nothing changed since the previous one) to write under 5 KB to the trace, so that the trace grows with what changes, not with time.
  Example: two ticks a minute apart with no change → the second adds a tick line and no new chunks, under 5 KB together (against ~650 KB today).
- B14 As a person with a long-running agent step, I want each run's hook facts stored once, in fixed blocks of 64 facts that are written once and never change, so that the trace grows linearly with a run's hooks instead of quadratically.
  Example: a run with 416 hook facts adds 6 full blocks once each over its life; each tick then adds only the last partial block when it changed.
- B15 As a person whose tick crashes midway through writing the trace, I want no tick line ever to name a chunk that was not written, so that a crash leaves at worst unused chunks.
  Example: a tick is killed after appending its chunks and before its tick line → the trace has extra chunks and no tick line; `norn why` on earlier ticks still works.
- B16 As a person whose list of chunks already written today is lost or stale, I want the next tick simply to write its chunks again, with no harm to replay.
  Example: the list is deleted → the next tick appends chunks that already exist; `norn why` on any of today's ticks replays the same as before.
- B17 As a person running `norn why` on a tick written by the new version, I want it to replay exactly: the same decisions from facts equal to the ones observe produced (O5).
  Example: `norn why --tick <id>` on a chunked tick → the rebuilt facts equal the observed facts byte for byte, and decide gives the recorded decisions.
- B18 As a person running `norn why` on a tick written before the upgrade, I want it to replay as it does today.
  Example: `norn why --tick <id>` on a tick from yesterday's file, written by the old version → the same answer as before the upgrade.
- B19 As a person who copies or keeps one day's trace on its own, I want the day file and its chunks file to be enough to replay every tick of that day, with no chunk taken from another day.
  Example: copy one day's two files into an empty trace folder → `norn why` replays every tick of that day.
- B20 As a person running `norn why` on a tick whose day has been pruned, I want a refusal that says so, not a guess.
  Example: `norn why --tick <id>` for a tick from 40 days ago with `trace.retain` 14d → exit 3, "tick 01… is older than the trace retained (14d)", and do-instead pointing at a newer tick.
- B21 As a person running `norn why` on a tick whose chunk is missing from a day that is still kept, I want the tick reported as a corrupt trace entry naming the missing hash, and never a replay from a partial snapshot (S2).
  Example: one chunk line removed by hand → `norn why --tick <id>` reports the trace entry as corrupt with the missing hash, and replays nothing.
- B22 As a contributor running the golden harvest, I want it to read chunked ticks and harvest the same cases it would from full ticks (X4).
  Example: the harness run with harvesting on, before and after the change, yields the same case names and decisions.

### Pruning

- B23 As a person, I want the trace retention window set by `trace.retain` in config, a duration with default `14d`.
  Example: no `trace.retain` in any config layer → `norn tidy` prunes what is older than 14 days; `trace.retain: 30d` → older than 30 days.
- B24 As a person, I want `norn tidy --retain <duration>` to override `trace.retain` for that run.
  Example: `trace.retain: 14d` and `norn tidy --retain 30d` → nothing newer than 30 days is pruned.
- B25 As a person, I want a window shorter than 14 days (the timelines' window), from config or flag, refused, so that tidy never deletes what the views still show.
  Example: `norn tidy --retain 7d` → exit 3, "the trace window must be at least 14d", do-instead naming 14d; nothing is deleted.
- B26 As a person, I want a `trace.retain` or `--retain` value that is not a duration refused with the expected form.
  Example: `norn tidy --retain soon` → refused, naming the expected form (e.g. `14d`); nothing is deleted.
- B27 As a person running `norn tidy`, I want it to delete each day file, with its chunks file, older than the window.
  Example: day files from 40 to 0 days ago, window 14d → the 26 oldest day pairs are deleted; the last 14 days stay.
- B28 As a person running `norn tidy`, I want it to delete the hook files of units with no live run and no change within the window.
  Example: gh-3 merged 30 days ago, its hook file last written then → deleted; gh-9's hook file with a live run → kept.
- B29 As a person running `norn tidy`, I want it to delete the briefings and transcripts of runs that are not live and are older than the window.
  Example: a run that ended 20 days ago → its briefings and transcripts are deleted; a run that ended yesterday → kept.
- B30 As a person, I want `norn tidy` never to delete anything a live run needs, nor any recorded workflow, however old.
  Example: a run that started 20 days ago and is still live → its hook file, briefings and transcripts are kept; a workflow recorded 60 days ago is kept.
- B31 As a person running `norn tidy --dry-run`, I want to see what would be pruned (day pairs, hook files, briefings, transcripts), with the bytes each would free, and nothing deleted.
  Example: `norn tidy --dry-run` lists `2026-09-15` day pair (1.1 GB), gh-3's hook file (2 MB), … and the trace is unchanged afterwards.
- B32 As a person running `norn tidy` twice, I want the second run to prune nothing.
  Example: `norn tidy` then `norn tidy` → the second reports nothing pruned from the trace.
- B33 As a person running `norn doctor`, I want a hint when the trace holds days older than the window, with how many and how large.
  Example: 45 days of trace and `trace.retain` 14d → "trace keeps 31 days (2.4 GB) beyond trace.retain 14d — run `norn tidy`"; within the window → no hint.
- B34 As a person running watch, I want neither watch nor any tick to prune the trace; only `norn tidy` does.
  Example: watch runs for 30 days without `norn tidy` → no day file is deleted.

### Upgrade and downgrade

- B35 As a person who reinstalls the previous release after upgrading, I want the older norn to keep working: it reads the new tick lines' decisions and inbox changes but its `norn why` cannot replay them (refused as a failed replay), ignores the hook files, and its own ticks write full facts that the new version reads unchanged. This one-way door is named as the merge danger of the PR that ships chunks.
  Example: downgrade after a day of chunked ticks → watch and ticks run; `norn why --tick <new id>` with the older norn cannot replay that tick; upgrading again → `norn why` replays both the chunked ticks and the older norn's full ticks.

## Out of scope

- SQLite or any other trace store — JSONL day files stay; the change is in what goes in them.
- A cursor into a hook log for `run.hooks` — run hooks include facts without a run id and are refined by the adapters, so replay must be self-contained.
- Chunk boundaries chosen by size — fixed boundaries keep chunks stable across ticks.
- A tick stored as a diff of the previous one — replay would depend on a chain, and one bad line would break every later tick.
- Incremental reads and skipping the view rebuild in the cockpit and watch — dropped; file again if a profile still shows the cockpit hot.
- Shrinking `Facts` itself — chunks make repeated facts cheap without changing what observe sees.
- Chunks shared across days, and mark-and-sweep of chunks — a day pair stays self-contained, so pruning deletes whole files.
- Gzip of old days — saves disk, not reads.
- Pruning from watch or the tick — pruning is a person's housekeeping in `norn tidy` (B34).
- A compatibility mode that keeps writing full facts for one release — it would give up the saving for that release (B35).

## Open questions

None.

## Plan

Agreed with the person on 2026-10-30. B3, B6, B8 and B35 were amended during planning (timelines leave the project view; a hook outside a unit worktree stays a no-op; ticks also read hook files changed within `limits.stalled`; the older norn reads new tick lines but cannot replay them).

### Seams

- **S1 the CLI, through the integration harness** (`createHarness`: `h.norn(…)` and ticks with the fake clock and fake ports, in a temp repo). Observes B1–B13, B17, B18, B20, B22–B35.
  "Opens no day file" (B1, B2, B8–B10) is observed through a trace-read observer in store, off by default, that sees every day file a reader opens — modelled on store's spawn observer (`setSpawnObserver`), which the effect transcripts already use. B22 is observed by the existing golden harvest (harness run with harvesting on, then the golden test).
  Prior art: the agent-protocol tests (hook, brief, blocked hooks), the inbox-why and why-version tests (`norn why`, history), the housekeeping tests (tidy, doctor), the cockpit tests (`cockpit --json`), the view tests (`loadProjectView`, timelines), the observe snapshots, and the golden test.
- **S2 the store trace module, through its public interface**: append and read a tick (facts resolved from chunks or a corrupt-entry error), append and read a unit's hook facts, and the prune plan. Observes the file-level cases that are awkward to stage through the CLI: B14, B15, B16, B19, B21.
  Prior art: the store trace tests ("trace (O4)" in the store config/trace tests), which write and read day files in a temp root.

Footprint and timing numbers (B1's ~10%, B2/B10's "about the same time") are not asserted in the suite: QA measures them with a benchmark script on a synthetic trace like the reported one (14 day files, ~2 GB, one live run with 400+ hook facts). The suite asserts the structure behind them: no day file opened, and the bytes a quiet tick writes (B13).

### Coverage

| Behaviour | Seam | Test kind | Notes |
|---|---|---|---|
| B1 | S1 | integration | `cockpit --json` and a refresh: observer sees no day file; footprint by QA benchmark |
| B2 | S1 | integration | `status`, `status --segment`, `inbox`: same output, no day file opened |
| B3 | S1 | integration | timelines through the view's timeline read and `norn trace` equal the old entries; project view has none |
| B4 | S1 | integration | `norn trace` output unchanged; a broken line of an unshown type is not reported |
| B5 | S1 | integration | hook in a unit worktree → line in the unit's hook file and the day file; `norn trace` shows it |
| B6 | S1 | integration | hook outside a unit worktree → nothing traced, no hook file (extends the existing A3 test) |
| B7 | S1 | integration | hook without a run id in a unit worktree → in the unit's hook file |
| B8 | S1 | integration | tick reads only qualifying hook files, no day file; same decisions |
| B9 | S1 | integration | blocked-hook limit answers as before; no day file read |
| B10 | S1 | integration | `brief` reads only its unit's hook file; timing by QA benchmark |
| B11 | S1 | integration | old-style trace with a live run's hook lines in day files → first tick backfills, second copies nothing |
| B12 | S1 | integration | hook lines already present plus a duplicate; a backfill left unfinished → next tick completes it, each id once |
| B13 | S1 | integration | two quiet ticks → second writes no chunk; tick line + chunks under 5 KB |
| B14 | S2 | unit | 416 hook facts → 6 full blocks written once; next append adds only the changed partial block |
| B15 | S2 | unit | chunks appended, tick line not → earlier ticks still read; extra chunks harmless |
| B16 | S2 | unit | written-chunks memory lost or stale → chunks written again; every tick of the day still reads the same |
| B17 | S1 | integration | `why --tick` on a chunked tick: rebuilt facts equal the observed facts byte for byte; decisions match |
| B18 | S1 | integration | `why` on a full-facts tick from an older norn replays as before |
| B19 | S2 | unit | one day pair copied to an empty trace dir → every tick of the day reads |
| B20 | S1 | integration | `why --tick` of a pruned day → exit 3 `tick_pruned` |
| B21 | S2 | unit | a chunk line removed → reading the tick reports a corrupt entry naming the hash, no facts (the CLI mapping to exit 4 rides on S1's why tests) |
| B22 | S1 | integration | golden harvest over chunked ticks yields the same case names and decisions |
| B23 | S1 | integration | default 14d; `trace.retain: 30d` honoured |
| B24 | S1 | integration | `--retain` overrides config |
| B25 | S1 | integration | window under 14d from config or flag → exit 3, nothing deleted |
| B26 | S1 | integration | non-duration → refused with the expected form |
| B27 | S1 | integration | day pairs older than the window deleted, the rest kept |
| B28 | S1 | integration | hook files of finished, untouched units deleted; live unit's kept |
| B29 | S1 | integration | briefings and transcripts of old, not-live runs deleted |
| B30 | S1 | integration | a live run older than the window keeps everything; `trace/workflows` kept |
| B31 | S1 | integration | `--dry-run` lists with bytes; trace unchanged |
| B32 | S1 | integration | second `tidy` prunes nothing |
| B33 | S1 | integration | `doctor` hint with count and size beyond the window; none within it |
| B34 | S1 | integration | ticks over 30 fake-clock days never delete a day file |
| B35 | S1 | integration | a chunked tick line validates against the older tick schema shape (`facts` an object), `inbox --history` reads it; full-facts ticks written after it are read and replayed by the new version |

### Prefactoring

1. **One day-file line reader in store.** The trace read, the hook-fact scan and the blocked-hook count each scan day files their own way; route them through one line iterator that the read observer hooks into. Makes the "opens no day file" assertions (B1, B2, B8–B10) possible at S1 and gives B4's skip-by-type one home.
2. **Move replay-input rebuilding from the cli tick runtime into a store read of a tick's decide inputs.** `why` and the golden harvest already share it; chunk resolution (B17, B18, B21, B22) then lands in one place.
3. **One unit-scoped hook-fact read in store**, used by the tick's local facts, `brief` (its cwd filter) and `hook` (the blocked count), still implemented over the day files. The hooks slice (B5–B12) then changes one function, not three callers.

### Implementation decisions

- D1 **Timelines leave the project view (B1–B3, X1).** `loadProjectView` no longer reads the trace and `ProjectView` loses `timeline`; `@norn/view` gets a separate timeline read for callers that show timelines (`norn trace` keeps `loadTraceView`). Trace parse errors leave the project view's errors. `cockpit`, `status`, `status --segment`, `inbox` and `orient` never call the timeline read.
- D2 **Lines are skipped by type without parsing (B4).** Every trace line is written with `type` as its first key; a reader given types skips any line whose prefix names another type. A garbage line is reported only by readers that read every type.
- D3 **Per-unit hook files (B5–B10, A2).** `trace/hooks/<story>/_story.jsonl` for a story unit and `trace/hooks/<story>/<slice nn>.jsonl` for a slice, in the main checkout's trace dir (the marker's repo). The line is the same hook event as the day file's (id, fact, blocked, reason). `norn hook` appends to the unit file first, then the day file; both unsynced appends. Outside a unit worktree nothing changes (A3, B6). Every reader of a hook file drops duplicate event ids and sorts by `at`.
- D4 **What a tick reads (B8).** The hook file of each unit with a live run or an unknown launch (R5.1), plus each unit whose hook file's mtime is within `limits.stalled` (one stat, no read otherwise) — the hook facts observe used for `step_runs` before, so decide sees the same facts. `brief` reads only its own unit's file; `hook` counts blocked hooks from its unit's file only (A4).
- D5 **Backfill on upgrade (B11, B12).** The first tick of the new version writes `trace/hooks/backfill.json` with `since` (its own time) and an empty `done` list. For each unit with a live run started before `since` and not in `done`, a tick scans the day files from the run's start for that unit's hook lines, appends those whose event id the unit file lacks (append only, never a rewrite, so a concurrent `norn hook` append is never lost), then adds the unit to `done`. Runs started after `since` need nothing. A crash before `done` is written just redoes the copy next tick, deduplicated by id.
- D6 **Tick line shape (B13, B17, B35, O4).** The tick line keeps the field `facts`, which now holds a skeleton marked `"$chunked": 1`: inline parts as they are, a chunked subtree replaced by `{"$chunk": "<hash>"}`, a run's hook list by `{"$blocks": ["<hash>", …]}`. The line stays valid under the older schema, so an older norn still reads its decisions and inbox changes; its `why` fails as a failed replay (B35). The tick schema accepts both shapes; a line without the marker is a full-facts tick, read as today (B18).
- D7 **Chunk boundaries (B13, B14).** Chunked: each story's facts (with each run's `hooks` as block references), each block of 64 hook facts cut by position in the run's refined hook list (Claude's refinement looks only backwards, so full blocks stay stable; a late hook just makes a new block), `remote.issues`, the replay config, and each workflow source. Inline: `tick_id`, `now`, `repo`, `machine`, `heartbeat`, `orphans`, the decisions and inbox changes. Rebuilding puts each value back where its reference stood, so the rebuilt facts serialize byte for byte as observed (B17).
- D8 **Chunks file (B15, B16, B19).** `<day>.chunks.jsonl` beside `<day>.jsonl`, day taken from the tick's `at`; one line per chunk, `{"h": "<sha256 hex of the value's JSON>", "v": <value>}`. Neither norn's day-file pattern matches the name. A tick appends all its new chunks in one write and fsyncs them before appending its tick line, so no tick line names an unwritten chunk; a quiet tick has none and pays no fsync. Each process remembers which hashes today's chunks file holds and trusts that only while the file's size equals the size after its own last append; otherwise it rebuilds the set by a hash-only scan. Duplicate chunk lines are harmless (same content). Reading a tick scans only that day's chunks file and parses only the lines whose hash it needs.
- D9 **Workflow sources become chunks (B19, B30).** New ticks store each workflow source as a chunk of the day; `trace/workflows/` stays for ticks written before the upgrade and is never pruned.
- D10 **`why` refusals (B20, B21, S2).** `why --tick <id>` for a tick that is not found and whose ulid time is older than now minus the retention window → refused, exit 3, code `tick_pruned`, "tick … is older than the trace retained (<window>)", do-instead naming a newer tick (`norn trace <unit>`). A chunked tick with a missing chunk → corrupt trace entry naming the missing hash, exit 4, code `trace_corrupt`; nothing is replayed.
- D11 **`trace.retain` (B23–B26).** New config key `trace.retain`, a duration, default `14d`, scope `machine` (the trace is machine-local). The 14-day minimum is checked where the value is used, not in the schema: `tidy` refuses a window under 14d or a non-duration (exit 3, or a usage error for a bad `--retain` form, naming `14d`); `doctor` reports such a config value as a warning and config loading does not fail. `tidy --retain <duration>` overrides it for that run.
- D12 **What `tidy` prunes (B27–B32, B34).** Under the tick lock tidy already takes: each day pair (day file and chunks file) whose date is older than today minus the window; each unit hook file whose unit has no live run and whose mtime is older than the window; each run's `briefings/<run>/` and `transcripts/<run>/` when the run is not live and the newest file in them is older than the window. Never: `trace/workflows/`, `backfill.json`, the caches and locks. Tidy's output gains a `trace` part (days, hook files and runs pruned, each with bytes, and the total freed); `--dry-run` lists the same and deletes nothing. Watch and the tick never prune.
- D13 **`doctor` hint (B33).** When day pairs older than the window exist: a hint (not a failed check) with how many days and how many bytes beyond `trace.retain`, naming `norn tidy`.
- D14 **PRD and the one-way door (B35).** Each slice amends the PRD ids it changes in its own diff (X1; A2/A4; O4/O5/X4; a new retention rule in the observability section). The PR that ships chunks names the downgrade as its merge danger: an older norn cannot replay chunked ticks; there is no compatibility mode.
- D15 **Chunked tick facts and 64-fact hook blocks ship together (B13–B19, B21, B22, B35).** Agreed with the person at approve-plan on 2026-10-30: one slice delivers the chunk layout (D6–D9) with the hook blocks of D7, not chunks first and blocks after. Reason: the `$blocks` reference is part of the tick line's skeleton, so splitting them would ship one tick line format and then change it again, with a second downgrade boundary and a second round of golden and replay checks. The slice is large; it is kept in one context by starting with the B13 spike and the S2 round-trip test (see Risks), then switching `why` and the golden harvest over.

### Testing decisions

A good test drives a command (S1) or the store trace interface (S2) and checks what a person or reader observes: command output and exit code, files under the trace dir, decisions and replays. No test reaches into chunk internals beyond S2's interface or checks private helpers. Fakes stay at system boundaries only: the harness's fake clock, remote, runner and notifier, plus the store read observer (a test hook that only observes). Old-format traces (full-facts ticks, hook lines only in day files) are built by writing day files the way the previous version wrote them, which is also how B11, B18 and B35 are staged. Size claims (B13) are asserted in bytes written; footprint and timing are QA's benchmark. The golden corpus, effect transcripts and observe snapshots change only where the trace layout is the intended change (transcripts record files under `runs/` only, so they should stay as they are); any rewrite is reviewed as a behaviour diff.

### Risks

- **The 5 KB quiet tick (B13) is not yet known to hold.** `machine` facts or the decisions may be larger than they look. The chunks slice starts with a spike: split a real recorded tick from this repo's trace by D7 and measure it; if over 5 KB, the largest inline part becomes a chunk too, without returning to the person.
- **Byte-for-byte replay (B17).** Rebuilding must reproduce key order and values exactly; a round-trip test at S2 over real recorded facts (golden cases) guards it before why is switched over.
- **Hook routing parity (B8, D4).** Facts without a run id are matched by worktree and start time today; moving to per-unit files must keep exactly the facts observe saw. The observe snapshots and golden harvest catch a drift; run them before and after the hooks slice.
- **Backfill on a large trace (B11).** The one-time scan reads the day files since the oldest live run; it is bounded and runs once, but on the reported machine it reads up to ~2 GB in one tick. It uses the same hash-free prefix scan as today's hook reader and runs under the tick lock.
- **Downgrade (B35).** One-way door; named in the chunks PR's merge danger.
- **The chunks-and-blocks slice is the largest (D15).** It carries the tick line format, the chunks file, the hook blocks and the switch of `why` and the golden harvest. It meets that by ordering: spike first, then S2 tests (B14–B16, B19, B21) before any CLI path reads chunks, then S1 (B13, B17, B18, B22, B35).
