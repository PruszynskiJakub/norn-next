# norn dogfood audit pack: Todoist sandbox (gh-1..gh-4)

Audited 2026-10-23 ~20:40 CEST. Everything here was read-only. No `tick`, `approve`, `answer` or `done` was run.

**Abbreviations**
- `SB` = `/Users/jakubpruszynski/Projects/norn-sandbox-todoist` (main checkout, with `export PATH="$SB/.bin:$PATH"`)
- `WT4` = `/Users/jakubpruszynski/Projects/norn-sandbox-todoist-worktrees/gh-4-quick-add-with-natural-language-parsing`
- `AUD` = `/private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn/97a9a328-d4c2-4cb8-a86c-29d9f43fa6a2/scratchpad/audit` (working files for this audit)

**Raw sources**
- `SB/.agents/norn/trace/2026-10-23.jsonl`: 288 records, of which 231 are `tick` and 57 are `briefing`. There are no hook records.
- `SB/.agents/norn/trace/briefings/<run_id>/*.md`: 57 briefings.
- `SB/.agents/norn/trace/notified.json`: inbox notification ids.
- `origin/main:.agents/specs/*/runs/**`: gh-1..gh-3. Extracted with `git archive origin/main .agents/specs | tar -x -C AUD/specs`.
- `WT4/.agents/specs/gh-4-*/runs/**`: gh-4. Copied to `AUD/specs`.

**Surface dumps**
- `AUD/trace-<unit>.{txt,json}`: `norn trace <unit> [--text] --limit 1000` for all 16 units.
- `AUD/why-all.txt`: `norn why <unit> --tick <id>` for every recorded decision (2,211 jobs).
- `AUD/timelines.md`: built from the receipts by `AUD/an.py`.
- `AUD/commits.tsv`: `git log --all` with the Norn-* trailers.

Rating scale: **good** (a norn surface answers it alone), **partial** (a norn surface answers part, or answers with truncation), **raw** (had to dig into raw files or write scripts over them), **impossible** (no recorded data).

---

## 1. Timelines per story and per slice

**Surfaces tried**
- `norn status --text`: gives the final step, the age and the counters per unit, e.g. `gh-1 … done 1h [qa_loop 1/2]`.
- `norn trace <unit> --text`: gives a chronological list of receipts, ticks and briefings with ISO timestamps, `step#attempt`, outcome and a truncated handoff.

**What the trace text does not give**
- Duration per step.
- Grouping by step or attempt.
- Story-level wall-clock.
- An explicit actor column. Agent receipts show `(manual, claude)`, but human gate receipts show no `who`.
- Noise filtering: 70–88% of every trace is noop ticks (`slices.wait`, `slice.done`, `story.finished`, `slice.not_started`). gh-1 has 192 noop entries out of 254; gh-4/01 has 142 out of 161. Count with `jq '.entries|map(select(.kind=="noop"))|length' AUD/trace-*.json`.
- Slice events are not rolled into the story trace.

So the tables below were computed from receipts (`by`, `who`, `at`, `run_id`) by `AUD/an.py`. **Rating: partial.** Timestamps and outcomes come from norn. Durations and actors had to be scripted over raw receipts.

### 1a. Story summary (UTC)

| Story | intake / start | first agent start | `$done` (ready.approve) | PR merged (GitHub) | norn saw merge (`remote.pr_merged`) | start→`$done` | agent runs | agent busy (Σ started→done) | rework |
|---|---|---|---|---|---|---|---|---|---|
| gh-1 | 16:10:41 / 16:11:14 | 16:12:28 refine | 16:59:30 | #5 17:06:11 | 17:06:32 | 48m16s | 18 | 33.4 min | story qa.fail → implement (qa_loop 1/2) |
| gh-2 | 16:10:41 / 16:11:14 | 16:14:15 refine | 18:01:58 | #7 18:11:05 (merge commit 524744d authored 18:02:52) | 18:11:32 | 1h50m44s | 16 | 48.7 min | gh-2/03 human-qa.reject → implement (qa_loop 1/2) |
| gh-3 | 16:10:41 / 16:11:14 | 16:14:12 refine | 17:42:09 | #6 18:11:03 | 18:11:32 | 1h30m55s | 13 | 32.5 min | none (AC6 ruling at gh-3/01 gate) |
| gh-4 | 16:10:41 / 16:11:14 | 16:14:12 refine | 18:35:38 | #8 still OPEN and **draft** | n/a | 2h24m24s | 10 | 23.6 min | none |

- **Whole run:** first tick 16:10:41.136Z, last tick 18:35:43.033Z, so 2h25m02s.
- **Ticks:** 231, all from one heartbeat `01M5MREQ3PXNG71GWB0MV6D0BT`.
- **Idle time:** gh-2..gh-4 sat between refine (≈16:15) and plan (17:00), and gh-4 sat at approve-plan from 17:04:53 to 18:12:25. Both waits were the orchestrator sequencing stories behind gh-1 (F8). norn shows them only as `unit.parked.attended` or `unit.parked.gate` noops, with no reason like "blocked behind gh-1".
- **Sources:**
  - Receipts: `AUD/specs/.agents/specs/*/runs/*/receipts/*.json`.
  - Merge times: `gh pr list --state all --json number,state,mergedAt`.
  - Ticks: `norn trace gh-N --text`, lines `remote.pr_merged`.

### 1b. Slice spans (first receipt → integrate classify)

| Slice | span | steps (visits) | human gate |
|---|---|---|---|
| gh-1/01 | 16:18:51→16:24:50 (5m59s) | impl, test, review, qa(pass), integrate | – |
| gh-1/02 | 16:25:20→16:32:11 (6m51s) | same, qa(pass) | – |
| gh-1/03 | 16:32:33→16:39:15 (6m41s) | qa(partial) → human-qa | approve |
| gh-1/04 | 16:39:34→16:44:56 (5m21s) | qa(partial) → human-qa | approve |
| gh-2/01 | 17:07:55→17:14:28 (6m33s) | qa(pass) | – |
| gh-2/02 | 17:14:48→17:24:07 (9m18s) | qa(partial) | approve |
| gh-2/03 | 17:24:28→17:38:18 (13m49s) | implement×2, test×2, review×2, qa×2 (partial, partial), human-qa×2 | **reject**, then approve |
| gh-3/01 | 17:07:55→17:15:52 (7m57s) | qa(partial) | approve (AC6 ruling) |
| gh-3/02 | 17:16:12→17:24:42 (8m30s) | qa(pass) | – |
| gh-3/03 | 17:25:04→17:35:53 (10m49s) | qa(partial) | approve |
| gh-4/01 | 18:12:43→18:20:37 (7m54s) | qa(pass) | – |
| gh-4/02 | 18:20:53→18:30:07 (9m13s) | qa(pass) | – |

### 1c. Full per-unit timelines (from receipts; `dur` = started→done for agent runs, `duration_ms` for checks)

In the `by/who` column, `agent/claude` means a subagent reported, `human` means a gate receipt (person = orchestrator), and `norn(tick)` means a check or classify written by the tick.

#### gh-1  (state: step=$done status=done counters={'plan_loop': 0, 'test_loop': 0, 'qa_loop': 1, 'ready_loop': 0} visits={'refine': 1, 'plan': 1, 'slice': 1, 'approve-plan': 1, 'slices': 1, 'test': 2, 'qa': 2, 'implement': 1, 'human-qa': 1, 'open-pr': 1, 'ready': 1} nudges=0 retries=0 applied_through=19 n_receipts=19)
| # | at (UTC) | kind | step#att | by/who | outcome | dur | note |
|---|---|---|---|---|---|---|---|
| 0001 | 16:12:28 | started | refine#1 | agent/claude |  |  |  |
| 0002 | 16:13:28 | done | refine#1 | agent/claude | done | 0:01:00 | Spec written below the story text in story.md (frontmatter unchanged): Context, B1-B32 (pe |
| 0003 | 16:14:12 | started | plan#1 | agent/claude |  |  |  |
| 0004 | 16:16:10 | done | plan#1 | agent/claude | done | 0:01:57 | plan.md written: seams S1 store.ts openStore(path,{now})->Store (all SQLite + domain rules |
| 0005 | 16:16:41 | started | slice#1 | agent/claude |  |  |  |
| 0006 | 16:18:05 | done | slice#1 | agent/claude | done | 0:01:24 | 4 slices in slices/: 01 store (P1 createApp extraction + S1 store, B1-B3,B5-B22 at store l |
| 0007 | 16:18:30 | approve | approve-plan#1 | human | approve |  |  |
| 0008 | 16:44:59 | classify | slices#1 | norn(tick) | done |  | 4 slice(s) integrated |
| 0009 | 16:45:08 | check | test#1 | norn(tick) | pass | 1.6s | bun install --frozen-lockfile && bun test && bun run typecheck |
| 0010 | 16:45:26 | started | qa#1 | agent/claude |  |  |  |
| 0011 | 16:49:03 | done | qa#1 | agent/claude | fail | 0:03:37 | Story QA via curl on :4040: 31/32 Behaviour items + tests AC pass. FAIL B12/edge 'delete a |
| 0012 | 16:49:52 | started | implement#1 | agent/claude |  |  |  |
| 0013 | 16:52:41 | done | implement#1 | agent/claude | done | 0:02:48 | QA B12 rework: ids of deleted items/projects were reused (INTEGER PRIMARY KEY without AUTO |
| 0014 | 16:53:13 | check | test#2 | norn(tick) | pass | 1.3s | bun install --frozen-lockfile && bun test && bun run typecheck |
| 0015 | 16:53:27 | started | qa#2 | agent/claude |  |  |  |
| 0016 | 16:57:37 | done | qa#2 | agent/claude | partial | 0:04:09 | Story QA #2 via curl on :4040 @ f72b212. The qa#1 failure is fixed: the exact B12 repro no |
| 0017 | 16:58:15 | approve | human-qa#1 | human | approve |  | Accepted on QA markup evidence; browser-only checks NOT performed by a person in this dogf |
| 0018 | 16:58:53 | classify | open-pr#1 | norn(tick) | done |  | draft PR #5 https://github.com/PruszynskiJakub/norn-sandbox-todoist/pull/5 |
| 0019 | 16:59:30 | approve | ready#1 | human | approve |  | PR reviewed |

span first→last receipt: 16:12:28 → 16:59:30 = 0:47:02


#### gh-1/01  (state: step=$done status=done counters={'test_loop': 0, 'review_loop': 0, 'qa_loop': 0, 'conflict_loop': 0} visits={'implement': 1, 'test': 1, 'review': 1, 'qa': 1, 'integrate': 1} nudges=0 retries=0 applied_through=8 n_receipts=8)
| # | at (UTC) | kind | step#att | by/who | outcome | dur | note |
|---|---|---|---|---|---|---|---|
| 0001 | 16:18:51 | started | implement#1 | agent/claude |  |  |  |
| 0002 | 16:20:54 | done | implement#1 | agent/claude | done | 0:02:03 | P1: createApp() extracted to src/app.ts (health() re-exported from server.ts; server.ts on |
| 0003 | 16:21:19 | check | test#1 | norn(tick) | pass | 0.6s | bun install --frozen-lockfile && bun test && bun run typecheck |
| 0004 | 16:21:33 | started | review#1 | agent/claude |  |  |  |
| 0005 | 16:22:12 | done | review#1 | agent/claude | approve | 0:00:39 | [findings:3] review#1 approve: AC1-AC18 all met and tested; bun test 48 pass, typecheck cl |
| 0006 | 16:22:37 | started | qa#1 | agent/claude |  |  |  |
| 0007 | 16:24:23 | done | qa#1 | agent/claude | pass | 0:01:45 | AC1-AC18 all pass, observed via standalone script calling openStore/createApp (not the rep |
| 0008 | 16:24:50 | classify | integrate#1 | norn(tick) | done |  | gh-1/01-store integrated into gh-1-projects-and-items at 9f517768897a |

span first→last receipt: 16:18:51 → 16:24:50 = 0:05:59


#### gh-1/02  (state: step=$done status=done counters={'test_loop': 0, 'review_loop': 0, 'qa_loop': 0, 'conflict_loop': 0} visits={'implement': 1, 'test': 1, 'review': 1, 'qa': 1, 'integrate': 1} nudges=0 retries=0 applied_through=8 n_receipts=8)
| # | at (UTC) | kind | step#att | by/who | outcome | dur | note |
|---|---|---|---|---|---|---|---|
| 0001 | 16:25:20 | started | implement#1 | agent/claude |  |  |  |
| 0002 | 16:27:50 | done | implement#1 | agent/claude | done | 0:02:29 | AC1-AC17 covered: test/api.test.ts (41 tests, createApp(openStore(':memory:')), incl. 500  |
| 0003 | 16:28:18 | check | test#1 | norn(tick) | pass | 1.1s | bun install --frozen-lockfile && bun test && bun run typecheck |
| 0004 | 16:28:32 | started | review#1 | agent/claude |  |  |  |
| 0005 | 16:29:18 | done | review#1 | agent/claude | approve | 0:00:45 | [findings:3] review#1 approve: AC1-AC17 all met with tests; bun test 92/92, typecheck clea |
| 0006 | 16:29:41 | started | qa#1 | agent/claude |  |  |  |
| 0007 | 16:31:45 | done | qa#1 | agent/claude | pass | 0:02:04 | qa#1 pass: AC1-AC17 verified with curl against the real server on :4060, each with a fresh |
| 0008 | 16:32:11 | classify | integrate#1 | norn(tick) | done |  | gh-1/02-json-api-and-server integrated into gh-1-projects-and-items at 636b4da7cd4c |

span first→last receipt: 16:25:20 → 16:32:11 = 0:06:51


#### gh-1/03  (state: step=$done status=done counters={'test_loop': 0, 'review_loop': 0, 'qa_loop': 0, 'conflict_loop': 0} visits={'implement': 1, 'test': 1, 'review': 1, 'qa': 1, 'human-qa': 1, 'integrate': 1} nudges=0 retries=0 applied_through=9 n_receipts=9)
| # | at (UTC) | kind | step#att | by/who | outcome | dur | note |
|---|---|---|---|---|---|---|---|
| 0001 | 16:32:33 | started | implement#1 | agent/claude |  |  |  |
| 0002 | 16:34:26 | done | implement#1 | agent/claude | done | 0:01:52 | Added src/views.ts (pure rendering, escape() on all text+attributes, itemRow() hook for gh |
| 0003 | 16:34:41 | check | test#1 | norn(tick) | pass | 1.1s | bun install --frozen-lockfile && bun test && bun run typecheck |
| 0004 | 16:34:54 | started | review#1 | agent/claude |  |  |  |
| 0005 | 16:35:33 | done | review#1 | agent/claude | approve | 0:00:39 | [findings:3] review#1: approve. AC1-5, AC7-9 met with seam-level tests; 121 pass, typechec |
| 0006 | 16:36:11 | started | qa#1 | agent/claude |  |  |  |
| 0007 | 16:38:24 | done | qa#1 | agent/claude | partial | 0:02:13 | QA#1 on real server (PORT 4050, fresh DB, curl): AC1-5, AC7-9 pass, 53 HTTP checks, 0 fail |
| 0008 | 16:38:53 | approve | human-qa#1 | human | approve |  | AC6 confirm() present on delete form; accepted on markup + QA evidence |
| 0009 | 16:39:15 | classify | integrate#1 | norn(tick) | done |  | gh-1/03-web-projects integrated into gh-1-projects-and-items at ae2c5d6e4702 |

span first→last receipt: 16:32:33 → 16:39:15 = 0:06:41


#### gh-1/04  (state: step=$done status=done counters={'test_loop': 0, 'review_loop': 0, 'qa_loop': 0, 'conflict_loop': 0} visits={'implement': 1, 'test': 1, 'review': 1, 'qa': 1, 'human-qa': 1, 'integrate': 1} nudges=0 retries=0 applied_through=9 n_receipts=9)
| # | at (UTC) | kind | step#att | by/who | outcome | dur | note |
|---|---|---|---|---|---|---|---|
| 0001 | 16:39:34 | started | implement#1 | agent/claude |  |  |  |
| 0002 | 16:41:24 | done | implement#1 | agent/claude | done | 0:01:49 | Item forms + Show completed. web.ts: POST /projects/:id/items, /items/:id/(edit/toggle/del |
| 0003 | 16:41:38 | check | test#1 | norn(tick) | pass | 1.1s | bun install --frozen-lockfile && bun test && bun run typecheck |
| 0004 | 16:41:52 | started | review#1 | agent/claude |  |  |  |
| 0005 | 16:42:28 | done | review#1 | agent/claude | approve | 0:00:36 | [findings:4] review#1 approve: AC1-6, AC8, AC9 met with tests; AC7 (browser) structurally  |
| 0006 | 16:43:01 | started | qa#1 | agent/claude |  |  |  |
| 0007 | 16:44:25 | done | qa#1 | agent/claude | partial | 0:01:24 | qa#1 partial: AC1-6, AC8, AC9 pass, checked over HTTP against the real server (PORT 4060,  |
| 0008 | 16:44:47 | approve | human-qa#1 | human | approve |  | AC7 markup verified (auto-submit checkbox, edit disclosure); accepted on QA evidence |
| 0009 | 16:44:56 | classify | integrate#1 | norn(tick) | done |  | gh-1/04-web-items integrated into gh-1-projects-and-items at aa49d4436bc0 |

span first→last receipt: 16:39:34 → 16:44:56 = 0:05:21


#### gh-2  (state: step=$done status=done counters={'plan_loop': 0, 'test_loop': 0, 'qa_loop': 0, 'ready_loop': 0} visits={'refine': 1, 'plan': 1, 'slice': 1, 'approve-plan': 1, 'slices': 1, 'test': 1, 'qa': 1, 'human-qa': 1, 'open-pr': 1, 'ready': 1} nudges=0 retries=0 applied_through=14 n_receipts=14)
| # | at (UTC) | kind | step#att | by/who | outcome | dur | note |
|---|---|---|---|---|---|---|---|
| 0001 | 16:14:15 | started | refine#1 | agent/claude |  |  |  |
| 0002 | 16:15:12 | done | refine#1 | agent/claude | done | 0:00:57 | Spec written in story.md body: Context, B1-B28, filled edge checklist, out of scope, no op |
| 0003 | 17:00:07 | started | plan#1 | agent/claude |  |  |  |
| 0004 | 17:02:31 | done | plan#1 | agent/claude | done | 0:02:24 | plan.md written against gh-1's code: seams S1 store (+due_date, today(), todayView/upcomin |
| 0005 | 17:03:58 | started | slice#1 | agent/claude |  |  |  |
| 0006 | 17:04:56 | done | slice#1 | agent/claude | done | 0:00:58 | 3 slices written in plan D14 order: 01 due date store+JSON API (B1-B11 store parts), 02 To |
| 0007 | 17:07:21 | approve | approve-plan#1 | human | approve |  |  |
| 0008 | 17:38:21 | classify | slices#1 | norn(tick) | done |  | 3 slice(s) integrated |
| 0009 | 17:38:29 | check | test#1 | norn(tick) | pass | 2.0s | bun install --frozen-lockfile && bun test && bun run typecheck |
| 0010 | 17:38:43 | started | qa#1 | agent/claude |  |  |  |
| 0011 | 18:00:28 | done | qa#1 | agent/claude | partial | 0:21:44 | Story QA via curl on real servers (ports 4030-4035), plus injected clock through openStore |
| 0012 | 18:01:04 | approve | human-qa#1 | human | approve |  | B25-27 accepted on evidence; year-suffixed headings acceptable; no browser check by a pers |
| 0013 | 18:01:24 | classify | open-pr#1 | norn(tick) | done |  | draft PR #7 https://github.com/PruszynskiJakub/norn-sandbox-todoist/pull/7 |
| 0014 | 18:01:58 | approve | ready#1 | human | approve |  | PR reviewed |

span first→last receipt: 16:14:15 → 18:01:58 = 1:47:43


#### gh-2/01  (state: step=$done status=done counters={'test_loop': 0, 'review_loop': 0, 'qa_loop': 0, 'conflict_loop': 0} visits={'implement': 1, 'test': 1, 'review': 1, 'qa': 1, 'integrate': 1} nudges=0 retries=0 applied_through=8 n_receipts=8)
| # | at (UTC) | kind | step#att | by/who | outcome | dur | note |
|---|---|---|---|---|---|---|---|
| 0001 | 17:07:55 | started | implement#1 | agent/claude |  |  |  |
| 0002 | 17:09:34 | done | implement#1 | agent/claude | done | 0:01:39 | AC1-AC11 covered test-first. store.ts: due_date column (PRAGMA table_info + ALTER TABLE mi |
| 0003 | 17:10:03 | check | test#1 | norn(tick) | pass | 1.2s | bun install --frozen-lockfile && bun test && bun run typecheck |
| 0004 | 17:10:17 | started | review#1 | agent/claude |  |  |  |
| 0005 | 17:11:16 | done | review#1 | agent/claude | approve | 0:00:58 | [findings:3] Review #1: approve. AC1-AC11 met and tested via store/API seams; bun test 200 |
| 0006 | 17:12:01 | started | qa#1 | agent/claude |  |  |  |
| 0007 | 17:14:07 | done | qa#1 | agent/claude | pass | 0:02:06 | QA #1 pass: AC1-AC11 verified against the real server on :4040 via curl (AC2 with a real g |
| 0008 | 17:14:28 | classify | integrate#1 | norn(tick) | done |  | gh-2/01-due-date-on-items integrated into gh-2-due-dates-with-today-and-upcoming-views at  |

span first→last receipt: 17:07:55 → 17:14:28 = 0:06:33


#### gh-2/02  (state: step=$done status=done counters={'test_loop': 0, 'review_loop': 0, 'qa_loop': 0, 'conflict_loop': 0} visits={'implement': 1, 'test': 1, 'review': 1, 'qa': 1, 'human-qa': 1, 'integrate': 1} nudges=0 retries=0 applied_through=9 n_receipts=9)
| # | at (UTC) | kind | step#att | by/who | outcome | dur | note |
|---|---|---|---|---|---|---|---|
| 0001 | 17:14:48 | started | implement#1 | agent/claude |  |  |  |
| 0002 | 17:19:03 | done | implement#1 | agent/claude | done | 0:04:14 | P1 (sidebar current-by-href) and P2 (toggleForm, backTarget) first with gh-1 suite unchang |
| 0003 | 17:19:22 | check | test#1 | norn(tick) | pass | 1.3s | bun install --frozen-lockfile && bun test && bun run typecheck |
| 0004 | 17:19:36 | started | review#1 | agent/claude |  |  |  |
| 0005 | 17:20:15 | done | review#1 | agent/claude | approve | 0:00:38 | [findings:3] review#1: approve. All AC1-AC8, AC10-AC18 met and test-proven (235 pass, tsc  |
| 0006 | 17:20:41 | started | qa#1 | agent/claude |  |  |  |
| 0007 | 17:23:31 | done | qa#1 | agent/claude | partial | 0:02:49 | qa#1 partial: AC1-AC8, AC10-AC18 pass with HTTP evidence against the real server on :4060  |
| 0008 | 17:23:58 | approve | human-qa#1 | human | approve |  | AC9 accepted on HTTP evidence; browser check not performed by a person in dogfood |
| 0009 | 17:24:07 | classify | integrate#1 | norn(tick) | done |  | gh-2/02-today-and-upcoming-views integrated into gh-2-due-dates-with-today-and-upcoming-vi |

span first→last receipt: 17:14:48 → 17:24:07 = 0:09:18


#### gh-2/03  (state: step=$done status=done counters={'test_loop': 0, 'review_loop': 0, 'qa_loop': 1, 'conflict_loop': 0} visits={'implement': 2, 'test': 2, 'review': 2, 'qa': 2, 'human-qa': 2, 'integrate': 1} nudges=0 retries=0 applied_through=17 n_receipts=17)
| # | at (UTC) | kind | step#att | by/who | outcome | dur | note |
|---|---|---|---|---|---|---|---|
| 0001 | 17:24:28 | started | implement#1 | agent/claude |  |  |  |
| 0002 | 17:26:42 | done | implement#1 | agent/claude | done | 0:02:14 | AC1,AC2,AC4,AC5,AC6 covered by red→green tests in test/web.test.ts (248 pass, typecheck cl |
| 0003 | 17:27:11 | check | test#1 | norn(tick) | pass | 1.3s | bun install --frozen-lockfile && bun test && bun run typecheck |
| 0004 | 17:27:21 | started | review#1 | agent/claude |  |  |  |
| 0005 | 17:27:58 | done | review#1 | agent/claude | approve | 0:00:37 | [findings:3] review#1: approve. AC1/2/4/5/6 tested via HTTP (248 pass, tsc clean); AC3 per |
| 0006 | 17:28:22 | started | qa#1 | agent/claude |  |  |  |
| 0007 | 17:29:31 | done | qa#1 | agent/claude | partial | 0:01:09 | qa#1 partial: AC1,AC2,AC4,AC5,AC6 pass via curl against real server :4050 (today 2026-10-2 |
| 0008 | 17:29:55 | reject | human-qa#1 | human | reject |  | AC7: on 404/5xx the inline due-date editor shows the raw HTML error page as the row's erro |
| 0009 | 17:30:23 | started | implement#2 | agent/claude |  |  |  |
| 0010 | 17:33:41 | done | implement#2 | agent/claude | done | 0:03:17 | implement#2 (human-qa reject rework): inline due-date script now shows the store's text on |
| 0011 | 17:34:15 | check | test#2 | norn(tick) | pass | 1.3s | bun install --frozen-lockfile && bun test && bun run typecheck |
| 0012 | 17:34:25 | started | review#2 | agent/claude |  |  |  |
| 0013 | 17:34:54 | done | review#2 | agent/claude | approve | 0:00:28 | [findings:2] review#2: approve. The rework is correct: 400 shows the store text, 404 shows |
| 0014 | 17:35:17 | started | qa#2 | agent/claude |  |  |  |
| 0015 | 17:37:40 | done | qa#2 | agent/claude | partial | 0:02:22 | qa#2 partial: the rework is fixed. The served inline script was run against the real serve |
| 0016 | 17:38:09 | approve | human-qa#2 | human | approve |  | Rework verified (error messages); AC3/AC7 accepted on evidence, no browser check by a pers |
| 0017 | 17:38:18 | classify | integrate#1 | norn(tick) | done |  | gh-2/03-due-dates-in-project-lists integrated into gh-2-due-dates-with-today-and-upcoming- |

span first→last receipt: 17:24:28 → 17:38:18 = 0:13:49


#### gh-3  (state: step=$done status=done counters={'plan_loop': 0, 'test_loop': 0, 'qa_loop': 0, 'ready_loop': 0} visits={'refine': 1, 'plan': 1, 'slice': 1, 'approve-plan': 1, 'slices': 1, 'test': 1, 'qa': 1, 'human-qa': 1, 'open-pr': 1, 'ready': 1} nudges=0 retries=0 applied_through=14 n_receipts=14)
| # | at (UTC) | kind | step#att | by/who | outcome | dur | note |
|---|---|---|---|---|---|---|---|
| 0001 | 16:14:12 | started | refine#1 | agent/claude |  |  |  |
| 0002 | 16:15:31 | done | refine#1 | agent/claude | done | 0:01:19 | Spec written in story.md: B1-B34 (priority 1-4 default 4, ordering priority then existing  |
| 0003 | 17:00:09 | started | plan#1 | agent/claude |  |  |  |
| 0004 | 17:02:57 | done | plan#1 | agent/claude | done | 0:02:47 | plan.md written against gh-1 (read-only) with gh-2 adaptation rules: seams S1 store (+labe |
| 0005 | 17:03:58 | started | slice#1 | agent/claude |  |  |  |
| 0006 | 17:05:16 | done | slice#1 | agent/claude | done | 0:01:17 | 3 slices per plan D16, strictly ordered: 01-store (P2,P3; S1: priority, byPriority orderin |
| 0007 | 17:07:25 | approve | approve-plan#1 | human | approve |  |  |
| 0008 | 17:35:56 | classify | slices#1 | norn(tick) | done |  | 3 slice(s) integrated |
| 0009 | 17:36:05 | check | test#1 | norn(tick) | pass | 1.9s | bun install --frozen-lockfile && bun test && bun run typecheck |
| 0010 | 17:36:19 | started | qa#1 | agent/claude |  |  |  |
| 0011 | 17:41:00 | done | qa#1 | agent/claude | partial | 0:04:41 | Story QA over HTTP (curl, :4020, DB started as a real gh-1 DB built by gh-1 code at 1d2233 |
| 0012 | 17:41:30 | approve | human-qa#1 | human | approve |  | B5/B23 accepted on evidence; no browser check by a person |
| 0013 | 17:41:49 | classify | open-pr#1 | norn(tick) | done |  | draft PR #6 https://github.com/PruszynskiJakub/norn-sandbox-todoist/pull/6 |
| 0014 | 17:42:09 | approve | ready#1 | human | approve |  | PR reviewed |

span first→last receipt: 16:14:12 → 17:42:09 = 1:27:56


#### gh-3/01  (state: step=$done status=done counters={'test_loop': 0, 'review_loop': 0, 'qa_loop': 0, 'conflict_loop': 0} visits={'implement': 1, 'test': 1, 'review': 1, 'qa': 1, 'human-qa': 1, 'integrate': 1} nudges=0 retries=0 applied_through=9 n_receipts=9)
| # | at (UTC) | kind | step#att | by/who | outcome | dur | note |
|---|---|---|---|---|---|---|---|
| 0001 | 17:07:55 | started | implement#1 | agent/claude |  |  |  |
| 0002 | 17:11:12 | done | implement#1 | agent/claude | done | 0:03:17 | Store S1 done: priority (default 4, validated), byPriority ordering (src/ordering.ts), glo |
| 0003 | 17:11:34 | check | test#1 | norn(tick) | pass | 1.2s | bun install --frozen-lockfile && bun test && bun run typecheck |
| 0004 | 17:11:57 | started | review#1 | agent/claude |  |  |  |
| 0005 | 17:12:49 | done | review#1 | agent/claude | approve | 0:00:52 | [findings:3] Approve: AC1-AC25 met and tested via Store; 199 pass, typecheck clean; P2/P3  |
| 0006 | 17:13:24 | started | qa#1 | agent/claude |  |  |  |
| 0007 | 17:15:17 | done | qa#1 | agent/claude | partial | 0:01:53 | QA via Store (openStore) scratch driver: AC1-AC5, AC7-AC25 pass with evidence (gh-1 DDL up |
| 0008 | 17:15:43 | approve | human-qa#1 | human | approve |  | Ruling: B6 stands (priority, then creation order); AC6 wording is wrong — correct order is |
| 0009 | 17:15:52 | classify | integrate#1 | norn(tick) | done |  | gh-3/01-store integrated into gh-3-priorities-labels-and-filters at 6fe8a210b7cb |

span first→last receipt: 17:07:55 → 17:15:52 = 0:07:57


#### gh-3/02  (state: step=$done status=done counters={'test_loop': 0, 'review_loop': 0, 'qa_loop': 0, 'conflict_loop': 0} visits={'implement': 1, 'test': 1, 'review': 1, 'qa': 1, 'integrate': 1} nudges=0 retries=0 applied_through=8 n_receipts=8)
| # | at (UTC) | kind | step#att | by/who | outcome | dur | note |
|---|---|---|---|---|---|---|---|
| 0001 | 17:16:12 | started | implement#1 | agent/claude |  |  |  |
| 0002 | 17:18:14 | done | implement#1 | agent/claude | done | 0:02:02 | AC1–AC17 covered by test/api.labels.test.ts (36 tests, red→green commits in 4 groups). src |
| 0003 | 17:18:37 | check | test#1 | norn(tick) | pass | 1.2s | bun install --frozen-lockfile && bun test && bun run typecheck |
| 0004 | 17:18:53 | started | review#1 | agent/claude |  |  |  |
| 0005 | 17:19:28 | done | review#1 | agent/claude | approve | 0:00:35 | [findings:2] review#1: approve. AC1–AC17 met and proven by test/api.labels.test.ts; bun te |
| 0006 | 17:19:53 | started | qa#1 | agent/claude |  |  |  |
| 0007 | 17:24:22 | done | qa#1 | agent/claude | pass | 0:04:28 | qa#1 pass: AC1–AC17 all observed via curl against the real server on :4040 (slot 4), fresh |
| 0008 | 17:24:42 | classify | integrate#1 | norn(tick) | done |  | gh-3/02-json-api integrated into gh-3-priorities-labels-and-filters at 8e69b8be55f9 |

span first→last receipt: 17:16:12 → 17:24:42 = 0:08:30


#### gh-3/03  (state: step=$done status=done counters={'test_loop': 0, 'review_loop': 0, 'qa_loop': 0, 'conflict_loop': 0} visits={'implement': 1, 'test': 1, 'review': 1, 'qa': 1, 'human-qa': 1, 'integrate': 1} nudges=0 retries=0 applied_through=9 n_receipts=9)
| # | at (UTC) | kind | step#att | by/who | outcome | dur | note |
|---|---|---|---|---|---|---|---|
| 0001 | 17:25:04 | started | implement#1 | agent/claude |  |  |  |
| 0002 | 17:30:12 | done | implement#1 | agent/claude | done | 0:05:08 | P1/P4 prefactor, then red→green (6 commits): priority select + colour classes/text alt (D8 |
| 0003 | 17:30:37 | check | test#1 | norn(tick) | pass | 1.9s | bun install --frozen-lockfile && bun test && bun run typecheck |
| 0004 | 17:30:50 | started | review#1 | agent/claude |  |  |  |
| 0005 | 17:32:01 | done | review#1 | agent/claude | approve | 0:01:10 | [findings:3] review#1 approve: all test-verified ACs (1,2,4,6-11,13,14) met and tested via |
| 0006 | 17:32:26 | started | qa#1 | agent/claude |  |  |  |
| 0007 | 17:35:22 | done | qa#1 | agent/claude | partial | 0:02:55 | QA#1 over HTTP (curl, :4060, fresh DB): AC1,2,4,6-11,13,14 pass with evidence (AC6 per B6  |
| 0008 | 17:35:44 | approve | human-qa#1 | human | approve |  | Person-only checks accepted on HTTP evidence; not checked in a browser in this dogfood run |
| 0009 | 17:35:53 | classify | integrate#1 | norn(tick) | done |  | gh-3/03-web-ui integrated into gh-3-priorities-labels-and-filters at d6799bb603ea |

span first→last receipt: 17:25:04 → 17:35:53 = 0:10:49


#### gh-4  (state: step=$done status=done counters={'plan_loop': 0, 'test_loop': 0, 'qa_loop': 0, 'ready_loop': 0} visits={'refine': 1, 'plan': 1, 'slice': 1, 'approve-plan': 1, 'slices': 1, 'test': 1, 'qa': 1, 'open-pr': 1, 'ready': 1} nudges=0 retries=0 applied_through=13 n_receipts=13)
| # | at (UTC) | kind | step#att | by/who | outcome | dur | note |
|---|---|---|---|---|---|---|---|
| 0001 | 16:14:12 | started | refine#1 | agent/claude |  |  |  |
| 0002 | 16:15:21 | done | refine#1 | agent/claude | done | 0:01:09 | Spec written in story.md: B1-B44 (parser tokens/dates/priority/project/labels/backtick lit |
| 0003 | 17:00:07 | started | plan#1 | agent/claude |  |  |  |
| 0004 | 17:02:43 | done | plan#1 | agent/claude | done | 0:02:35 | plan.md written: S1 pure parseQuickAdd(input,{today,projects,labels?}) in src/quickadd.ts  |
| 0005 | 17:03:58 | started | slice#1 | agent/claude |  |  |  |
| 0006 | 17:04:53 | done | slice#1 | agent/claude | done | 0:00:55 | Two slices written: 01-parser (S1, B1-B32 as 18 unit-test ACs, no deps) and 02-endpoint-an |
| 0007 | 18:12:25 | approve | approve-plan#1 | human | approve |  |  |
| 0008 | 18:30:10 | classify | slices#1 | norn(tick) | done |  | 2 slice(s) integrated |
| 0009 | 18:30:18 | check | test#1 | norn(tick) | pass | 2.3s | bun install --frozen-lockfile && bun test && bun run typecheck |
| 0010 | 18:30:27 | started | qa#1 | agent/claude |  |  |  |
| 0011 | 18:34:50 | done | qa#1 | agent/claude | pass | 0:04:22 | Story QA: all 44 Behaviour items (B1-B44) pass. Parser checked through POST /api/quick-add |
| 0012 | 18:35:25 | classify | open-pr#1 | norn(tick) | done |  | draft PR #8 https://github.com/PruszynskiJakub/norn-sandbox-todoist/pull/8 |
| 0013 | 18:35:38 | approve | ready#1 | human | approve |  | PR reviewed |

span first→last receipt: 16:14:12 → 18:35:38 = 2:21:25

#### gh-4/01  (state: step=$done status=done counters={'test_loop': 0, 'review_loop': 0, 'qa_loop': 0, 'conflict_loop': 0} visits={'implement': 1, 'test': 1, 'review': 1, 'qa': 1, 'integrate': 1} nudges=0 retries=0 applied_through=8 n_receipts=8)
| # | at (UTC) | kind | step#att | by/who | outcome | dur | note |
|---|---|---|---|---|---|---|---|
| 0001 | 18:12:43 | started | implement#1 | agent/claude |  |  |  |
| 0002 | 18:16:45 | done | implement#1 | agent/claude | done | 0:04:02 | S1 parser done: src/quickadd.ts (pure parseQuickAdd + QuickAddContext/QuickAddParse types  |
| 0003 | 18:17:05 | check | test#1 | norn(tick) | pass | 1.6s | bun install --frozen-lockfile && bun test && bun run typecheck |
| 0004 | 18:17:15 | started | review#1 | agent/claude |  |  |  |
| 0005 | 18:18:23 | done | review#1 | agent/claude | approve | 0:01:07 | [findings:3] review#1: approve. AC1-AC18 all met and tested via parseQuickAdd tables; scop |
| 0006 | 18:18:45 | started | qa#1 | agent/claude |  |  |  |
| 0007 | 18:20:13 | done | qa#1 | agent/claude | pass | 0:01:27 | qa#1 pass: AC1-AC18 each exercised via parseQuickAdd with 127 own inputs (scratch qa.ts),  |
| 0008 | 18:20:37 | classify | integrate#1 | norn(tick) | done |  | gh-4/01-parser integrated into gh-4-quick-add-with-natural-language-parsing at 0d94e24c6d2 |

span first→last receipt: 18:12:43 → 18:20:37 = 0:07:54


#### gh-4/02  (state: step=$done status=done counters={'test_loop': 0, 'review_loop': 0, 'qa_loop': 0, 'conflict_loop': 0} visits={'implement': 1, 'test': 1, 'review': 1, 'qa': 1, 'integrate': 1} nudges=0 retries=0 applied_through=8 n_receipts=8)
| # | at (UTC) | kind | step#att | by/who | outcome | dur | note |
|---|---|---|---|---|---|---|---|
| 0001 | 18:20:53 | started | implement#1 | agent/claude |  |  |  |
| 0002 | 18:24:22 | done | implement#1 | agent/claude | done | 0:03:29 | AC1–AC10 test-first in 7 local commits. P1: clock injection was only on openStore, so adde |
| 0003 | 18:24:47 | check | test#1 | norn(tick) | pass | 1.8s | bun install --frozen-lockfile && bun test && bun run typecheck |
| 0004 | 18:24:55 | started | review#1 | agent/claude |  |  |  |
| 0005 | 18:25:44 | done | review#1 | agent/claude | approve | 0:00:48 | [findings:3] review#1 approve: AC1–AC10 met with tests that would fail without the change  |
| 0006 | 18:26:07 | started | qa#1 | agent/claude |  |  |  |
| 0007 | 18:29:42 | done | qa#1 | agent/claude | pass | 0:03:35 | qa#1 pass: AC1–AC15 verified on real server :4030 (fresh DB). AC1: gh-2/gh-3 on branch, 56 |
| 0008 | 18:30:07 | classify | integrate#1 | norn(tick) | done |  | gh-4/02-endpoint-and-ui integrated into gh-4-quick-add-with-natural-language-parsing at 59 |

span first→last receipt: 18:20:53 → 18:30:07 = 0:09:13


---

## 2. Counts

**Sources**
- Receipts: `python3 AUD/an.py`.
- Ticks: computed over `SB/.agents/norn/trace/2026-10-23.jsonl`.
- Status: `norn status --text` shows the counters.

**Rating: raw.** norn has no aggregate or "retro" view (`retro` is mentioned in PRD §7 for trace but does not exist). `status` gives only the final counters per unit.

### 2a. Ticks and actions

| Metric | Value |
|---|---|
| Ticks | 231 (1 heartbeat) |
| Decisions | 2,211 (1,917 noop) |
| Non-noop actions | apply_receipts 123 · claim 94 (84 renew, 6 reacquire, 4 acquire) · run_check 18 · run_git 16 (12 integrate, 4 open-pr) · start_slices 12 · mark_done 12 · intake_story 4 · start_unit 4 · update_story_mirror 4 · classify 4 · cleanup_merged_story 3 |
| Action results with `ok:false` | 0 |
| Tick duration: local, no action | median 0.75 s, p90 0.90 s (n=55) |
| Tick duration: local with action (commit+push) | median 3.3 s, p90 10.6 s (n=146) |
| Tick duration: with remote sync | median 7.9 s, p90 22.3 s, max 34.0 s (n=30) |
| `status` / `inbox` / `trace` / `why` | 0.38 s / 0.59 s / 0.34 s / 0.22 s |

### 2b. Receipts (152 total)

| Kind | Count | Breakdown |
|---|---|---|
| started | 57 | all `how: manual`, `agent: claude`. **All carry the same `process.pid` 4345**, which is the orchestrator `claude` process started 13:00:52 (`ps -p 4345`), not the subagent. |
| done | 57 | refine 4, plan 4, slice 4 · implement 14 (done) · review 13 (approve 13, changes_requested 0) · qa 18 (pass 7, partial 10, fail 1) |
| check | 18 | test: pass 18, fail 0. No `runs/*/logs/` exists, which is consistent with C5. |
| classify | 20 | slices.done 4, integrate.done 12, open-pr.done 4 |
| approve | 17 | approve-plan 4 (no comment) · human-qa 9 · ready 4 (all "PR reviewed") |
| reject | 1 | gh-2/03 human-qa |
| ask / stuck / answer / unstick / mode / workflow | 0 | – |

### 2c. Outcomes and loops

| Item | Value |
|---|---|
| Review findings | 38 across 13 reviews: 15 minor, 23 nit, **0 blocking** |
| QA outcomes | slice level: 6 pass, 7 partial. Story level: gh-1 fail → partial; gh-2 partial; gh-3 partial; gh-4 pass. |
| Gate decisions | 18: 17 approve, 1 reject. Every gate has a matching `approve:<unit>:<step>#n` id in `notified.json`. |
| Rework loops | 2. **gh-1 story** qa.fail → implement#1 → test#2 → qa#2, `qa_loop 1/2`. **gh-2/03** human-qa.reject → implement#2 → test#2 → review#2 → qa#2 → human-qa#2, `qa_loop 1/2`. |
| Other counters | test_loop, review_loop, conflict_loop, plan_loop and ready_loop were all 0 everywhere. nudges_used 0, retries_used 0. |
| Classified agent faults | silent, died, timeout, stalled: 0. These paths were never exercised. |

### 2d. Human interventions

| Kind | Count | Visible to norn? |
|---|---|---|
| Gate receipts (approve/reject) | 18 | yes (receipts and trace) |
| Manual agent launches (manual mode `norn brief`) | 57 | yes (`started`, `how: manual`) |
| Attended steps played by the "person" (refine, plan, slice × 4) | 12 | Only as agent receipts. The person's part is invisible. |
| Out-of-band `git merge origin/main` into story branches | 5. c1c64d5 (gh-2), 0af9d45 (gh-3), 5b31d57 (gh-4) at 17:07:08Z; e0b65bf (gh-3 conflict resolution, 18:10:36Z); 8984ab3 (gh-4, 18:12:23Z). | **no** (see §6) |
| PR undraft and merge on GitHub | 3 (#5, #6, #7) | Only the final `state: merged`. The undraft is invisible. |
| Answers, unsticks, mode or workflow changes | 0 | – |

---

## 3. PRD §19 success criteria 1–5

| # | Criterion | Evidence | Verdict | Norn surface rating |
|---|---|---|---|---|
| 1 | Every agent run ends in a classified outcome; no "unknown" | 57 `started` ↔ 57 `done`, matched by run_id (script in `AUD/an.py` style over receipts). No run lacks a terminal receipt. The string `"unknown"` appears 0 times in tick decisions. | **Met.** But every outcome was *reported*. The classifier (silent, died, stalled) was never exercised, and `died` could not have fired: the pid is the orchestrator's (above), and the `run` facts have `session=null`, `transcript=null`, `pane=null`, `hooks=[]`, `process_alive=true` in all 92 snapshots. | raw. No norn view lists "runs and how each ended". |
| 2a | No step executes twice for the same attempt | No duplicate `(unit, step, attempt)` among `started`, `check` or `classify` receipts. Every one of 180 norn commits maps to exactly one tick. | **Met** | raw |
| 2b | No counter exceeded | max `qa_loop 1/2` (gh-1, gh-2/03). Everything else is 0. | **Met** | **good** (`norn status --text` shows `[qa_loop 1/2]`) |
| 2c | Zero step transitions by agents | Every `state.json` change is in a commit with `Norn-Tick` (180/180). The only trailer-less commits touching `runs/` are the 5 out-of-band person merges, which bring in other stories' runs from main. `git diff d569f9c e0b65bf -- .agents/specs/gh-3*` shows no gh-3 state change. All 123 transitions come from `receipts.apply` decisions. | **Met** (agents) | raw |
| 3 | Take/brief on another machine | Not exercised in this run | n/a | – |
| 4a | `norn why` explains every action | Replayed **all 2,211 decisions**: `norn why <unit> --tick <id>` (`AUD/why-all.txt` plus a sequential redo of 26 lines garbled by parallel output). Result: **2,207/2,207 per-unit decisions `replay.matches=true, all_match=true`, rule equal to the recorded rule** (1,914 noop, 293 act). The 4 `remote.intake` decisions recorded as unit `"*"` **cannot be queried** (`not a story or slice key: '*'`, code `usage`; this is F5). | **Mostly met.** Replay is faithful. But `why` without `--tick` shows only the latest tick (a `story.finished` noop for done units). There is no way to ask "why did gh-2/03 go back to implement" without first finding the tick id in the trace. `why` gives `advance.counter` (qa_loop 1/2) and the unapplied receipt *filename* (`0008-reject`), not the reason text. | partial |
| 4b | Inbox shows every human-needed item within one tick | `notified.json` has 73 ids: 55 your_turn and 18 approve. All 18 gates are present. 55 of 57 agent runs were notified. gh-1/01 and gh-1/02 implement#1 were briefed 16 s after `slices.start`, before the next tick, so they were never notified (harmless). **Missing entirely:** the 4 "merge the PR" actions. `norn inbox` lists `$done … waiting for the PR merge` under **Recently done**, with only `norn trace` as the command and no PR URL (F25 verified live). `notified.json` has no timestamps and no history view, so "within one tick" can't be checked from norn. | **Partially met** | raw (`notified.json`). `norn inbox` shows only the present moment. |
| 5 | tick, brief, status, inbox < 1 s | status 0.38 s, inbox 0.59 s, why 0.22 s, trace 0.34 s. Local no-op tick median 0.75 s. **Local ticks with an action: median 3.3 s, because of commit and push.** | Met for reads. Ticks that act exceed 1 s (H6 says "local state", but a push is remote). | good (`duration_ms` is in the trace) |

---

## 4. Why did each rework happen? Gate reasons

### gh-1 story qa.fail (16:49:03)

| Surface | What it shows |
|---|---|
| `norn trace gh-1 --text` | `receipt done fail at qa#1 — Story QA via curl on :4040: 31/32 … FAIL B12/edge 'delete already-deleted -> 404': ids o…`. Truncated at about 140 chars, so the root cause is cut off. |
| `norn trace gh-1` (JSON) | Same summary, plus `ref: "0011-done.json"` with no directory. |
| `norn why gh-1 --tick <apply tick>` | `advance qa→implement`, `counter qa_loop 1/2`. No reason text. |
| `norn status` | `[qa_loop 1/2]` |
| Raw | `runs/_story/receipts/0011-done.json` has the full handoff ("INTEGER PRIMARY KEY without AUTOINCREMENT…"). The repro is in `runs/_story/evidence/01M5MTEB6T37MVRHZ5FADDAQTK/B12-repro.md`. |
| `handoff.md` Progress | Full handoff line (also embedded in the next brief) |

**Rating: partial.** The "what" is visible. The "why" and the repro need raw files.

### gh-2/03 human-qa.reject (17:29:55)

| Surface | What it shows |
|---|---|
| `norn trace gh-2/03 --text` | `receipt reject human-qa: AC7: on 404/5xx the inline due-date editor shows the raw HTML error page as the row's error text (review F1, confirmed by …`. Truncated, so the instruction "Show a short human message… with a test" is lost. |
| `norn why gh-2/03 --tick 01M5MWZVHHJXDZ95KC84EE6SS7` | `unapplied: ["0008-reject"]`, `advance human-qa→implement, qa_loop 1/2`. No comment. |
| Raw | `runs/03-due-dates-in-project-lists/receipts/0008-reject.json`, field `comment` |

The reject traces back to review#1 finding 1, which was **minor and non-blocking**. Review approved a defect that the person later rejected. Nothing links the reject to the finding except prose. **Rating: partial.**

### Person's gate reasons, including the AC6 ruling

- Every approve or reject with a comment shows in `norn trace <unit> --text`, truncated.
- **AC6 ruling:** `norn trace gh-3/01 --text` shows `approve human-qa: Ruling: B6 stands (priority, then creation order); AC6 wording is wrong — correct order is a,b,d,c` (short enough to fit). Raw source: `gh-3-priorities-labels-and-filters/runs/01-store/receipts/0008-approve.json`.
- The ruling exists **only** in that slice's receipt. It is in no story-level surface, and the spec text was never changed: `slices/01-store.md:21` and `slices/03-web-ui.md:21` still say AC6 as originally written.
- The 4 gh-3 briefings after 17:15 (gh-3/03 implement, review, qa; gh-3 story qa) contain **0** occurrences of "Ruling" or "B6 stands" (`grep -c` on `briefings/01M5MWPXJ8YWPWBB4HWEK89YAG`, `01M5MX1G40HJ6B2HVDM948R2XE`, `01M5MX4DV9F8WB5HM94KBBEZ1X`, `01M5MXBGK6M7F5M1FBWD1W0X3G`).
- The gh-3/03 implementer re-raised the conflict in its handoff (`runs/03-web-ui/receipts/0002-done.json`: "Note: AC6 text says 'a after d'… contradicts B6").
- approve-plan approvals carry no comment. All 4 ready approvals say "PR reviewed".

**Rating: partial.** The reason can be found per unit, but it is truncated and does not propagate.

---

## 5. Commits ↔ ticks ↔ receipts

**Source:** `AUD/commits.tsv` (`git log --all --format=…%(trailers:key=Norn-…)`).

| Metric | Value |
|---|---|
| Commits on all refs | 252 |
| `norn:` commits with trailers | **180/180** have `Norn-Story` and `Norn-Tick`; 121 have `Norn-Slice`; 169 have `Norn-Step`. The 11 without a step are intake, start and "done (PR merged)" commits. |
| `Norn-Tick` found in trace | **180/180** |
| Commit SHA recorded in that tick's `result.detail.sha` | 109/180 |
| Other 71 | Copies of slice commits rewritten onto the story branch at integrate: same message and author date, new committer date. Example: `9a97624` on `origin/gh-4/02-endpoint-and-ui` is in the trace; `e0d18c4` on the story branch is not. The trailer still maps them to the tick. The integrate classify receipt names only the final integrated SHA. |
| Commits without trailers | 72: agent TDD commits (where agents committed themselves), the setup commits, the 5 person merges and the 3 GitHub PR merges |

- Receipts map to commits through `Norn-Tick` and the tick's `decisions[].action.applied` receipt numbers.
- No norn command does commit → tick → receipt. `norn trace` does not print commit SHAs. **Rating: raw**, but fully reconstructable.
- norn also commits directly to `main` after a merge, for example `0db01d3 norn: gh-2 done (PR merged)` and `5cb0e8e`, which change one line in `story.md`.

---

## 6. Out-of-band actions norn did not see

| Action | Commit / time (UTC) | In `norn trace`? | In raw trace? |
|---|---|---|---|
| `git merge origin/main` into gh-2, gh-3, gh-4 story branches | c1c64d5, 0af9d45, 5b31d57 @ 17:07:08 | no entry, rule or note | Only as a changed `facts.stories[].worktree.status.head` in the tick of 17:07:27 (5b31d57 appears in 112 later snapshots, passively) |
| gh-3 conflict-resolution merge **after `$done`** and after the PR was approved as ready | e0b65bf @ 18:10:36. 10 files, 1,265 insertions, e.g. `test/web.test.ts +430` | no | `worktree.status.head` in the 18:11:14 snapshot only |
| gh-4 merge of main | 8984ab3 @ 18:12:23 | no | head in 18:12:27 snapshot |
| PR #5/#6/#7 undraft and merge by person | 17:06:11, 18:11:03, 18:11:05 | `remote.pr_merged → cleanup_merged_story` only | `facts.stories[].pr = {state, draft, merged_at}`. There is **no head SHA, merged_by or merge_commit**, so "PR head ≠ reviewed head" can't be detected (F35 verified). |
| PR #8 left as draft after `ready.approve` | – | no | `pr.draft: true` from 18:35:25. norn does not undraft on ready. |

**Rating: impossible** from norn surfaces, and passively raw only through head SHAs.

**Side effect (F36 verified):** norn finds stories by scanning story worktrees and then the main checkout, which is on stale local `main` `ec5063d` (`packages/store/src/snapshot.ts` `loadSnapshot`). When the story worktree is cleaned up, the story disappears from facts:

- gh-1 disappeared at 17:06:55 and gh-2/gh-3 at 18:12:07.
- They came back (17:07:27, 18:12:27) **only because the person's out-of-band merge put their specs into a surviving worktree.**
- Today `norn status gh-2` reports `"root": ".../gh-4-quick-add-with-natural-language-parsing"`. gh-1..gh-3's record is being read from gh-4's worktree. `records.json` is `{"records": []}`.

---

## 7. Hook facts

- **Zero hook events.** There are no `type: "hook"` records in the JSONL and no `source: "hook"` entries in any `norn trace` output.
- `SB/.claude/settings.json` does install the `norn hook …` commands.
- `trace/transcripts/` does not exist.
- In all 92 `run` snapshots: `last_hook_at=null`, `hooks=[]`, `session=null`, `transcript=null`, `pane=null`.

This is expected (F9): the subagents ran outside the sandbox's Claude session. The cost is that `ask (implicit)`, `stalled`, `silent` and C4 snapshots were unobservable. `norn doctor` would not reveal this per run. **Rating: good.** The absence is clear from the trace (no hook source) and from the run facts.

---

## Observability scorecard

| Question | Norn surface used | Rating | Gap |
|---|---|---|---|
| Q1 Timeline per unit | `trace --text`, `status --text` | partial | No step durations, no step/attempt grouping, no story wall-clock, 70–88% noop noise, no `who` on human receipts, no story+slices merged view |
| Q2 Counts | `status` (final counters only) | raw | No aggregate or retro (receipts by kind, outcome mix, loops, gate latency, human interventions) |
| Q3 §19.1 classified outcomes | none | raw | No "runs and how they ended" view. Liveness facts are meaningless for subagents (single pid). |
| Q3 §19.2 no double exec, counters | `status` counters | good / raw | Counters good. Duplicate checks need scripts. |
| Q3 §19.4 why | `why --tick` | partial | Faithful replay (2,207/2,207), but needs a tick id. `*` intake decisions are unqueryable. No "why did step X change" query. |
| Q3 §19.4 inbox | `inbox` (now only) | raw | No inbox history or timestamps. PR-merge action is not an inbox item. |
| Q4 Rework reasons, gate reasons | `trace` (truncated), `why` | partial | Reason text truncated to about 140 chars. `why` names the receipt file only. Rulings don't propagate. |
| Q5 Commits ↔ ticks ↔ receipts | none (git trailers) | raw | Trailers are 100% present. No norn command maps them. Integrate rewrites 71 SHAs. |
| Q6 Out-of-band actions | none | impossible | Foreign commits, post-`$done` head changes and PR undraft are not recorded as facts or events |
| Q7 Hooks | `trace` (absence), raw run facts | good | `doctor` gives no per-run "hooks absent" warning |

---

## Friction items verified against raw data

| Item | Verdict | Evidence |
|---|---|---|
| **F22 (HIGH)** No Rework section after story qa.fail | **Verified, with nuance.** The brief `trace/briefings/01M5MTPFRRM90Q144WTKA8T5PK/01M5MTPFS7V7GS2NTA10XEDVF3.md` (gh-1 implement#1) has no `## Rework`. Inputs say "Last failing check: `see Rework`" and "Last findings: `see Rework`", but the section doesn't exist. The qa#1 handoff line does appear under Context → Progress (from handoff.md). The evidence dir path (`runs/_story/evidence/01M5MTEB6T37MVRHZ5FADDAQTK/`, `B12-repro.md`) is not given. | `grep '^## Rework'` over all 57 briefings |
| **F31 (HIGH)** Reject comment missing from rework brief | **Verified.** `briefings/01M5MX0NTECSV7HSCAAXCPGGMS/01M5MX0NVHEVX62W0CQV18EXND.md` says "You are here because of `human-qa.reject`" and then lists only the 3 findings from **review#1 (approve)**. `grep -c 'Item not found'` = 0. The comment lives only in `receipts/0008-reject.json`. | – |
| F17 Rework framing on forward transitions | **Verified, systemic.** 14 of 57 briefings have `## Rework`. **13** of them are `qa#n` after `review.approve`. Only 1 is a real rework (F31), and none is the qa.fail rework (F22). | `for f in $(grep -l '^## Rework' briefings/*/*.md)…` |
| F13 Claim renewal takes the unit's action slot | **Verified.** 84 `claim.renew` decisions. 14 of them were on a story unit with unapplied receipts and no `receipts.apply` that tick. Each delayed apply by one tick (6–40 s). | Trace JSONL script, §2 |
| F33 Brief diff uses stale local main | **Verified.** All 5 story-level briefs say ``git diff main...HEAD``. Local `main` = `ec5063d` (README typo, pre-gh-1). After the 17:07 merges, gh-2/3/4 story diffs include all of gh-1. Slice briefs use the story branch (correct). | `git rev-parse main` |
| F36 status omits gh-2/gh-3 after cleanup | **Verified, with root cause.** Stories vanish from tick facts after cleanup and reappear only via another worktree (§6). | – |
| F19 PORT_BASE not surfaced | **Refuted for briefs.** All 57 briefings contain `Port slot: N (PORT_BASE=…)` under Limits. It is still absent from skills and slice docs. | – |
| F5 `"unit":"*"` for intake | **Verified.** `norn why '*'` is refused. | – |
| F25 PR-merge action not in inbox | **Verified live** (`norn inbox --text`) | – |
| F34 PR #7 OPEN/CONFLICTING while merged | **Not verifiable from trace.** There were no ticks between 18:02:03 and 18:11:14. GitHub now reports mergedAt 18:11:05Z, while merge commit 524744d was authored 18:02:52Z, which is consistent with F34. | – |
| F35 Post-`$done` head change invisible | **Verified.** PR facts have no head SHA, and e0b65bf (+1,265 lines) landed after `ready.approve` with no event. | – |
| F27 Squashed implement commits | **Consistent.** gh-1/01..03 and the gh-1 story rework show only `norn:` commits plus one agent summary commit. gh-2/02+ agents committed red/green themselves. | `AUD/commits.tsv` |

---

## Top-10 norn improvements (prioritized, evidence-backed)

1. **Rework briefs must carry the actual reason.** On any backward edge, render the triggering receipt in full: qa `handoff` plus the absolute evidence path, the reject `comment`, and the failing check log. Drop the Rework section on forward edges. (F22, F31, F17: 13/14 Rework sections are on forward edges and 0/2 real reworks were fully briefed.)
2. **Gate and ruling notes as story-level context.** Add `norn note`, or promote gate comments flagged as a ruling, into the story handoff and every later brief, with an optional spec-amend path. (AC6 ruling: 0 mentions in 4 later gh-3 briefs. Spec still wrong.)
3. **Durable story records independent of worktrees.** Read finished stories from `origin/<base>`, or persist them in `records.json`, which is currently empty. Never depend on stale local `main`. (F36: stories vanished from facts at 17:06:55 and 18:12:07. `status gh-2` reads from gh-4's worktree.)
4. **Observe foreign commits and PR head drift.** Record `pr.head_sha`, `merge_commit` and `merged_by`. Emit trace events and inbox items for non-norn commits on story or slice branches and for head ≠ reviewed head after `ready` (re-run test/QA or ask). Also handle "branch head ⊂ origin/base" as merged. (§6, F35, F34)
5. **`norn trace` as a real timeline.** Group by step and attempt with durations and actor (`who` on human receipts). Add a `--no-noop` default, a story view that rolls up slices, full reason text (`--full`), and absolute `ref` paths. (Q1: 70–88% noise, 140-char truncation.)
6. **`norn retro` / `norn report`.** Aggregate receipts by kind and outcome, loops and counters, gate latency, agent busy time, human interventions and tick-time distribution. (Q2 was answered entirely by scripts.)
7. **`norn why` by question, not tick.** Allow `why gh-2/03 --step implement#2`, `--at <time>` and `--transition`, and print the triggering receipt's reason. Make intake decisions queryable instead of using unit `*`. (2,207/2,207 replays match, but they are unreachable without a tick id.)
8. **Inbox completeness and history.** Make "merge PR #N `<url>`" (and undraft on `ready`) an Approve or Your-turn item. Timestamp `notified.json` and add `norn inbox --history`. (F25, PR #8 still draft. Criterion 4b can't be checked.)
9. **Per-run identity and liveness when hooks are absent.** Record the agent's own session or pid (not the parent's pid 4345, shared by 57 runs). Flag runs with `hooks=0` and `session=null` as "unobserved" in status and doctor so `died`/`stalled` gaps are explicit. (§7, §3.1)
10. **Separate claim renewal from unit progress, and fix diff bases.** Renew claims outside the one-action-per-unit budget (F13: 14 delayed applies). Use `origin/<base>` or merge-base for story diffs (F33: 5 story briefs diff against pre-gh-1 `main`). Keep pre-integrate slice SHAs linked to the rewritten SHAs in the integrate receipt (71 commits unmapped by SHA).

## Addendum — gh-4 lifecycle completed
PR #8 merged (5c85cad); next sync tick ran remote.pr_merged → cleanup_merged_story; norn recorded 'gh-4 done (PR merged)' (87f5b63) on main. All 4 stories merged; no worktrees or slice branches remain.

# Audit conclusions (2026-10-23)

## What worked
- Deterministic core: 2,207/2,207 `norn why` replays matched recorded decisions; no step ran twice per attempt; no counter exceeded; zero transitions by agents (all moved by tick from receipts).
- Full story lifecycle exercised on 4 real stories / 13 slices / 57 agent runs: intake, attended refine/plan, slice, approve-plan gate, slices with implement→test→review→qa→integrate, human-qa gates, story test/qa, open-pr, ready gate, PR-merge cleanup (GR6) incl. remote slice-branch deletion.
- Rework paths worked mechanically: gh-1 story qa.fail → implement (qa_loop 1/2) fixed a real bug (id reuse); gh-2/03 human-qa.reject → implement fixed raw-HTML error text.
- Commit trailers on 180/180 norn commits; parallel stories (gh-2/gh-3) ran without unit conflicts.

## Fixed during the audit (PR #1, norn-next)
- fa6a184 — rework briefs show the real reason (qa fail handoff/findings/evidence, reject comment), no rework framing on forward steps, qa skill passes findings/evidence. (F17, F22, F31)
- f3138a1 — readable `norn trace` timeline with durations/who/totals; durable story records from origin/<base>; PR merge facts, merge-by-ancestry, foreign-commit and PR-head-change detection; inbox "Merge PR #N", Check group, inbox history; `why` by step/transition/rule; gate rulings carried into later briefs. (F5, F21, F25, F28, F33, F34, F35, F36 + scorecard gaps)

## Open backlog (not fixed)
1. handoff.md contradiction (F10): skill says keep it current, rules forbid editing runs/ — every agent hit it. Move handoff out of runs/ or exempt its body.
2. No step/verb to bring a story branch up to date with base after sibling merges (F8) — person merged main by hand 4×; conflict resolution after $done happened outside norn.
3. Attended steps when no person is in the pane (F14, F29): "report once the person agrees" unrepresentable; brief "Mode: manual" confused with attended.
4. Claim renewal consumes the unit's one action per tick (F13) — 14 delayed receipt applications.
5. No outcome for "can't verify here" (agent-verified browser checks without a browser) or "pass with a note for a person" (F30, F37).
6. Brief inputs list "see Rework" on attempt 1; per-worktree setup (bun install) and check config keys missing (F3, F16).
7. Not exercised at all: auto mode, Herdr/headless runners, hook facts (agents ran as subagents → zero hook events; `died` undetectable since all runs shared one pid), team handoff across machines, glab.
8. Retroactive detection: foreign commits and inbox history only exist from the tick that observes them — no backfill.
