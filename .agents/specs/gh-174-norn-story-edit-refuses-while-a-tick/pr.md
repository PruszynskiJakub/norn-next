## Summary

A person command that needs the tick lock (`story edit --workflow|--at`, `story checkout|handoff|close|reset|reopen`, `tidy`, and the claim release when `watch` stops) no longer refuses `tick_locked` the moment a tick is running. It waits for the tick, up to 60s, prints one line on stderr saying so, then runs as before. `tick`, `migrate` and `story edit --auto|--manual` are unchanged.

```diff
 person command
-  acquireTickLock → busy? refuse tick_locked
+  waitForTickLock(ctx, note, retry)            # runtime/tick-lock.ts, one helper for all 8 call sites
+    try acquireTickLock → ok? return           # dead holder still reclaimed at once by store
+    log "waiting for a running tick (pid …, <note>, since HH:MM:SS) — up to 60s…"   # stderr, once
+    every 250ms (ctx.sleep): aborted? refuse "interrupted…" · 60s on ctx.clock? refuse "…waited 60s" · retry
   observe, judge, act as today                 # state read only after the lock is held
```

To support this, `CliDeps.sleep`/`Context.sleep` (the injected sleep tests use to advance the fake clock) is now shared with `story wait`, and the identical timer copies in `watch` and `story wait` are gone. Rule H1 and `docs/reference.md` ("Output and exit codes") now describe the wait.

## Evidence

Tests: [`packages/cli/test/integration/tick-lock-wait.test.ts`](https://github.com/PruszynskiJakub/norn-next/blob/gh-174-norn-story-edit-refuses-while-a-tick/packages/cli/test/integration/tick-lock-wait.test.ts). The test process holds the real tick lock as a live holder, and an injected sleep advances the fake clock. These tests failed before the change, when every command refused at once. The workflow's `test` check passed on them (unit + integration tiers + typecheck). There was no separate QA step in this round.

- **B1** No tick running → runs at once
  **Before:** runs at once.
  **After:** `tidy` exits 0, no wait line, sleep never called.
- **B2** A running tick → waits, then runs
  **Before:** refused `tick_locked`, exit 5.
  **After:** lock released on the 3rd poll → `tidy` exits 0. Each command (story edit --at/--workflow, checkout, reset, handoff, close, reopen) waits once and is never refused `tick_locked`.
- **B3** One stderr wait line naming the tick
  **Before:** no line.
  **After:** exactly one log line matching `waiting for a running tick (pid <n>, norn tick, since HH:MM:SS) — up to 60s…`, with the holder's pid.
- **B4** stdout and exit unchanged
  **Before:** n/a.
  **After:** `tidy --json` after a wait has the same exit as a no-wait run. The wait line goes only to the log (stderr).
- **B5** Judged against the state the tick left
  **Before:** refused before judging.
  **After:** a tick applies the agent's `done` during the wait → `story edit gh-6 --at draft` is refused `round_finished` at the new cursor (`$done`).
- **B6** Refusals come right after the wait
  **Before:** `tick_locked` hid the real answer.
  **After:** `story edit --workflow` on an unfinished round waits, then is refused `round_unfinished`, exit 3.
- **B7** Still held after 60s → `tick_locked`
  **Before:** refused at once.
  **After:** exit 5, `code: tick_locked`, `do_instead: retry: norn tidy`. The error names the pid, `norn tick`, `since HH:MM:SS` and says `waited 60s`. Fake time waited is within [60s, 61s).
- **B8** Dead holder taken over at once
  **Before / After:** unchanged, no wait line, no sleep. The test uses a made-up pid 999999, not a reaped process as the plan said (review nit).
- **B9** Ctrl-C while waiting → nothing changed
  **Before:** n/a.
  **After:** abort during the sleep → exit 5 "interrupted while waiting for a running tick". The lock file is byte-identical and `runs/` is unchanged. The implementer also checked this by hand once with the dev build in a throwaway repo (`tidy`, Ctrl-C → wait line, then exit 5 "interrupted…").
- **B10** Two person commands both complete
  **Before:** the second refused.
  **After:** the holder changes mid-wait to another command → the first `tidy` waits on within one budget with one line, and both exit 0. Review note: the second command starts after the lock frees, so it never waits itself. It goes through the same helper.
- **B11** `watch` skips a busy tick as before
  **After:** `watch --max-ticks 1` with the lock held → `skipped_busy: 1`.
- **B12** `watch`'s exit release waits
  **Before:** release refused `tick_locked`.
  **After:** the same run logs one wait line, then releases every claim (`ok: true`).
- **B13** `migrate` refuses at once
  **After:** unchanged. The existing `migrate.test.ts` `tick_locked` test stays green.
- **B14** `tick` refuses at once
  **After:** `tick_locked`, sleep never called.
- **B15** `story edit --manual` never waits
  **After:** with the lock held → exit 0, no wait line, no sleep.
- **B16** Rules and docs say so
  **After:** H1 in `.agents/RULES.md` and "Output and exit codes" in `docs/reference.md` list the commands that wait, the 60s limit and Ctrl-C, and say that `tick`/`migrate` refuse at once. Checked by review and the docs lint, not by a test.

## Merge danger

**Door:** two-way: no schema, file format or persisted state changes. A revert brings back the refusal at once.

**Blast radius:** people at the terminal: a person command can now pause up to 60s instead of failing at once, and so can `watch`'s Ctrl-C exit (a second Ctrl-C still hard-exits). Scripts see the same stdout and exit codes. Only the timing changes, plus one extra stderr line.
