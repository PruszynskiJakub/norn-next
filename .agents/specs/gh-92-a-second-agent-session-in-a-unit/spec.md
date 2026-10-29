---
id: gh-92
slug: a-second-agent-session-in-a-unit
provider: gh
number: 92
url: https://github.com/PruszynskiJakub/norn-next/issues/92
title: A second agent session in a unit worktree joins the running run, and its report commits the first session's work
assignee: PruszynskiJakub
labels:
  - friction
  - norn
workflow: triage
status: new
intake_at: 2026-10-29T10:38:15.319Z
body_hash: 5d6f629a319b2888b925f23df4d44b74b895e08fea29e0efa6838a6c04c34069
---

## Observed

gh-79, `fix` workflow, step `implement`, manual mode, run `01M63J3HTKWVV6FZE9A851A7Z9` (UTC, 2026-10-29). Two Claude sessions were open in the gh-79 worktree:

- `4898c994…` had finished `reproduce` and was then used for `/issue` (#91).
- `bace8e35…` was opened fresh for `implement`.

1. 10:08:20 `bace8e35` runs `norn brief`. It starts the run: `0004-started.json` has `agent_session_id: bace8e35…`, pid 11470.
2. 10:12:03 `4898c994` runs `norn brief` in the same worktree. It gets the same run (`briefing` trace event, same `run_id`) with no warning that the run belongs to another session.
3. 10:12:12 `4898c994` reports `norn ask`: "This session already finished reproduce … norn attached the new implement run to it. Should I implement … here, or will you open a fresh agent?" (`0005-ask.json`). norn accepts it as the run's report and parks the unit.
4. The commit for that ask (`11e53b8`, "gh-79 implement#1 asks: …") stages the whole worktree. It includes `bace8e35`'s uncommitted, half-finished fix: 8 files under `packages/`, the renamed test, and a golden case. `bace8e35` was still working and found its work already committed under the other session's ask.
5. 10:14:32 the person answers: "Implementation already takes place on a new session" (`0006-answer.json`). The unit runs again.
6. 10:15:15 `agent.silent.surface` → nudge (`0007-classify.json`, "turn ended without a receipt"). The snapshot is `4898c994`'s transcript, not that of the session the run recorded. That session's turn end counted against the run and used one of its 2 nudges.
7. `bace8e35` finished and reported `done done` (`0008-done.json`) on the same run.

## Wanted

A run belongs to the session that started it. When another agent session in the worktree runs `norn brief` (or `done`/`ask`/`stuck`) while the run is live, norn refuses. The refusal says which session holds the run and what to do: end this session, or the person retries the step fresh. It does not hand the run over. Hook facts from a session other than the run's are not credited to the run, so they never cause `silent`/`stalled` classifications, nudges or transcript snapshots. With that, a report's boundary commit can only ever take the run's own session's work.

## Repro

1. In a throwaway repo, let norn start a story in manual mode on an agent step.
2. Session A in the unit worktree: `norn brief` → `started` receipt with A's `agent_session_id`.
3. Session B in the same worktree: `norn brief` → succeeds, same `run_id`.
4. A edits a file without committing. B runs `norn ask "?"` → the tick's park commit includes A's file.
5. B's turn ends → the next tick classifies the run `silent` from B's hook facts.

## Where

- Brief joins any live run, no session check: `packages/cli/src/commands/brief.ts:153-168` (`currentRun`, `startRun` only when none). The run's session is taken from the last hook in the worktree: `recentSession`, `brief.ts:46-56`.
- Reports take the worktree's current run, no session check: `reportTarget`, `packages/cli/src/runtime/report.ts:20-30`.
- Hook facts get the current run's id by worktree alone: `packages/cli/src/commands/hook.ts:142-145`. They are read per run by `run_id`: `packages/cli/src/runtime/observe/run-facts.ts:71-72`.
- The boundary commit stages everything: `git add -A`, `packages/adapters/src/git/index.ts:352`.

## PRD

- MO3: a run starts with the first `norn brief` and its `started` receipt records session and PID. Nothing says a later brief from another session is refused, or that the run stays with its session.
- B2, C1: nudges and answers go into the same session. Here a nudge was counted from another session's turn end.
- P6/S5 and S4: a report's commit is the run's own boundary. Here it took another session's work in progress.
