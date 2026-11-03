---
id: gh-174
slug: norn-story-edit-refuses-while-a-tick
provider: gh
number: 174
url: https://github.com/PruszynskiJakub/norn-next/issues/174
title: Workflow switches with norn story edit go through without retries and never leave a unit corrupt
assignee: PruszynskiJakub
labels:
  - friction
  - norn
  - norn:wf:quick
workflow: quick
status: active
intake_at: 2026-11-03T11:42:41.614Z
body_hash: 0613bb82769d8103269fb82e44a96ae1d532e97c7760831755cebbc55812564e
---

# Person commands wait for a running tick instead of refusing

## Problem

A person working with `norn watch` running finds a tick holding the checkout's tick lock most of the times they look: a tick takes 1–10s, a remote-sync tick about 9s (#78). Every person command that needs that lock refuses at once with `tick_locked` ("a tick is running, retry when it finishes"), so the person retries by hand until they land between two ticks. Switching #157 from triage to quick took several retries of `norn story edit`. The same refusal hits `norn tidy`, `story checkout`, `story handoff`, `story close`, `story reset` and `story reopen`. Nothing the person does is wrong; they only lose time and attention to a lock that would free itself in seconds.

## Solution

A person command that needs the tick lock waits for a running tick to finish, up to 60 seconds, and then runs exactly as it does today. While it waits it prints one line saying so and naming the tick it waits for. Only when the tick is still running after 60 seconds does it refuse with `tick_locked`, as today, saying how long it waited. Its output, refusals and exit codes are otherwise unchanged. The commands that wait are `story edit --workflow`, `story edit --at`, `story checkout`, `story handoff`, `story close`, `story reset`, `story reopen`, `tidy`, and the claim release a clean `watch` exit does. `norn migrate` and `norn tick` keep refusing at once.

## Behaviour

- B1 As a person, I want a waiting command to run at once when no tick runs, so that nothing gets slower in the common case.
  Example: no tick running; `norn story edit gh-157 --workflow quick --at implement` → runs at once, prints no wait line, output identical to today.

- B2 As a person, I want a command that finds a tick running to wait for it and then run, so that I never retry by hand.
  Example: `watch` is in a 9s sync tick; `norn story edit gh-157 --workflow quick --at implement` → prints the wait line, and within a second of the tick ending runs and prints its usual result, exit 0.

- B3 As a person, I want one line on stderr while a command waits, naming the tick and the limit, so that I know why it pauses and which tick to look at if it is stuck.
  Example: `norn tidy` while tick pid 4821 runs → stderr: `waiting for a running tick (pid 4821, norn tick, since 11:42:03) — up to 60s…`; nothing more is printed until the command's normal output. The line is printed once, and only when the lock is busy on the first try.

- B4 As a script calling these commands, I want stdout and exit codes unchanged, so that nothing that reads them breaks.
  Example: `norn story edit gh-157 --at review --json` while a tick runs → the wait line goes to stderr; stdout is the same single JSON value as today; the exit code is the same.

- B5 As a person, I want the command to judge my request against the state the tick left, so that its answer is never based on a copy that tick just changed.
  Example: a tick applies the running agent's `norn done` and moves gh-157 from `implement` to `review` while `norn story edit gh-157 --at implement` waits → after the tick, the edit is judged against the cursor at `review` (and accepted or refused as `story edit --at` would be at that cursor today).

- B6 As a person, I want every refusal a command gives today to come back right after the wait, so that waiting never hides or postpones a "no".
  Example: gh-157's round is unfinished; `norn story edit gh-157 --workflow quick` while a tick runs → after the tick, refused with `round_unfinished` and its `do_instead`, as today.

- B7 As a person, I want a command still blocked after 60 seconds to refuse as today, saying how long it waited and which tick holds the lock, so that a stuck tick is visible rather than waited on forever.
  Example: a tick has held the lock for 2 minutes; `norn story checkout gh-157` → after 60s, refused with `tick_locked` (the busy exit code), the message names pid, note and start time of the holding tick and says it waited 60s.

- B8 As a person, I want a lock left by a dead tick taken over at once, as today, so that a crashed tick never costs me a wait.
  Example: the lock names a pid that no longer runs; `norn tidy` → reclaims the lock and runs immediately, no wait line.

- B9 As a person, I want to stop a waiting command with Ctrl-C and find nothing changed, so that I can give up safely.
  Example: `norn story reopen gh-120` is waiting; Ctrl-C → the command exits, the lock was never taken, no receipt, file or ref was written.

- B10 As a person running two of these commands at once, I want both to complete, one after the other, so that my own commands do not refuse each other.
  Example: `norn story edit gh-157 --at review` holds the lock; `norn tidy` started meanwhile prints the wait line and runs when the edit finishes. Each command waits up to its own 60s.

- B11 As a person, I want `watch` to go on as today while one of my commands holds the lock, so that a waiting command never breaks the loop.
  Example: `norn tidy` holds the lock when `watch`'s next tick is due → that tick is skipped as busy (counted in `skipped_busy`), and `watch` ticks again at its next interval.

- B12 As a person stopping `watch`, I want its clean-exit claim release to wait for a running tick too, so that a tick started elsewhere (cron, by hand) does not make the exit fail to release.
  Example: Ctrl-C on `watch` while a `norn tick` from cron runs → watch prints the wait line, then releases its claims as today.

- B13 As a person, I want `norn migrate` to keep refusing at once while a tick runs, so that it still tells me to stop `watch` before it rewrites config or moves the trace.
  Example: `norn migrate` while a tick runs → refused at once with `tick_locked` and "stop norn watch (and any tick), then run norn migrate again", as today.

- B14 As a person, I want `norn tick` to keep refusing at once while another tick runs, so that duplicate ticks never queue up.
  Example: `norn tick` while `watch`'s tick runs → refused at once with `tick_locked`, as today.

- B15 As a person, I want `norn story edit --auto|--manual` unchanged, so that a mode switch stays instant.
  Example: `norn story edit gh-157 --manual` while a tick runs → succeeds at once, as today, no wait line.

- B16 As a reader of the rules and docs, I want them to say that person commands wait for a running tick, up to 60 seconds, and which commands do not, so that the behaviour is not a surprise.
  Example: rule H1 says a person command that needs the tick lock waits up to 60s for a running tick and then refuses, and that `migrate` and `tick` refuse at once; the docs describing these commands say the same.

## Out of scope

- Queueing an edit as a receipt for the next tick to apply — rejected: most of these commands have nothing a tick could apply, and a queued edit would report its refusals late.
- #143 (a workflow switch leaving a unit corrupt when another receipt lands first) — a separate story; waiting neither causes nor fixes it.
- Making ticks faster or recording where they spend time — #78.
- A `--wait` flag or a config key for the 60s limit — nobody needs to change it yet.
- `norn migrate` waiting — it refuses on purpose, so the person stops `watch` first.

## Open questions

## Plan

### Seams

- **S1 the cli command surface, through `runCli` in the cli harness (`createHarness`), with time faked at its boundary.** Observes B1–B15. The test holds the tick lock itself through store's tick-lock acquisition (the test process is a live holder), runs a person command, and reads its stdout, exit code and the stderr lines it logs (`deps.log`). The 60s limit and the polling are driven by a new injected sleep (D2) that advances the harness's fake clock, so a 60s wait costs no real time; inside that fake sleep the test may release the lock, run a tick, or start another command, which is how B2, B5 and B10 are staged. A lock left by a dead holder (B8) names a process the test started and reaped.
  Prior art: the `tick_locked` test in the cli machine-dir integration tests (holds the lock, runs a command), the watch tests in the cli runtime integration tests (`--max-ticks`, captured `log`, `skipped_busy`), the story-edit / story-reopen / story-reset integration tests for each command's ordinary output.
- **S2 the docs and rules, through review and the docs lint.** Observes B16. No new test: rule H1 is already amended; the docs that describe these commands say the same, and the docs lint keeps their links and command names valid.

### Coverage

| Behaviour | Seam | Test kind | Notes |
|---|---|---|---|
| B1 | S1 | integration | no lock held: output equal to today's, no wait line, the fake sleep never called |
| B2 | S1 | integration | fake sleep releases the held lock on its first call; command then runs, exit 0 |
| B3 | S1 | integration | exactly one log line, with pid, note and start time of the holder and "up to 60s"; none when the first try succeeds |
| B4 | S1 | integration | `--json` while waiting: stdout one JSON value equal to the no-wait run's, same exit code |
| B5 | S1 | integration | fake sleep releases the lock and runs a tick that applies a pending `done`; `story edit --at` is judged at the new cursor |
| B6 | S1 | integration | `story edit --workflow` on an unfinished round after a wait → `round_unfinished`, as today |
| B7 | S1 | integration | lock never released: after 60s of fake time → `tick_locked`, exit busy, message names pid, note, start time and "waited 60s" |
| B8 | S1 | integration | lock naming a dead process: runs at once, no wait line, fake sleep never called |
| B9 | S1 | integration | abort the command's signal during the fake sleep → refuses, lock file still the test's, no receipt/file/ref written |
| B10 | S1 | integration | fake sleep hands the lock from the test to a second command's run; the first waits on, within one 60s budget, one wait line |
| B11 | S1 | integration | test holds the lock, `watch --max-ticks 1` → `skipped_busy: 1`, no wait (regression guard; unchanged code) |
| B12 | S1 | integration | test holds the lock when `watch` stops; fake sleep releases it; watch logs the wait line and releases its claims |
| B13 | S1 | integration | existing migrate `tick_locked` test stays green; fake sleep never called |
| B14 | S1 | integration | existing tick `tick_locked` test stays green; fake sleep never called |
| B15 | S1 | integration | `story edit --manual` while the lock is held: succeeds, no wait line |
| B16 | S2 | review | docs lint guards the links and command names |

### Prefactoring

1. Route the eight places a person command takes the tick lock (story edit --workflow, story edit --at, story checkout, story reopen, tidy, the shared observe-under-lock used by story close/reset/handoff, and watch's clean-exit claim release) through one cli helper that, for now, refuses at once exactly as each does today (each keeps its own refusal text). Buys: the story then changes one function, not eight, and B1–B10 and B12 hold for every command by construction; the tests need to cover the behaviour once plus one smoke run per command.

### Implementation decisions

- D1 **One cli runtime helper waits for the tick lock**, built on store's existing tick-lock acquisition, which stays unchanged (it already reclaims a dead holder, B8). It retries every 250ms until it takes the lock or 60s have passed on the context clock (B2's "within a second"). `tick`, `migrate`, `story edit --auto|--manual` and watch's per-tick acquisition do not use it (B11, B13–B15). The command reads state only after it holds the lock, as today, which gives B5 and B6 for free. — Alternative rejected: a waiting variant in store; the wait line, the abort signal and the refusal are cli concerns.
- D2 **A new optional `sleep(ms, signal)` in the command dependencies**, defaulting to a real timer; elapsed time is measured on the context clock. Tests inject a sleep that advances the fake clock. — Time is the system boundary here; a short real limit in tests would be slow and flaky.
- D3 **The wait line goes through the context's progress log** (stderr in the real binary), printed once, only after a failed first try, also under `--json`: `waiting for a running tick (pid <pid>, <note>, since <HH:MM:SS local>) — up to 60s…`; `<note>` is left out when the lock has none. stdout is untouched (B3, B4).
- D4 **The timeout refusal** stays `busyError` with code `tick_locked` (exit busy, 5). Its error names the holder as the wait line does and says it waited 60s; its `do_instead` keeps each command's retry hint; `details` carries the holder's lock content. No schema change.
- D5 **Ctrl-C while waiting.** Ordinary commands pass the run's abort signal (the real binary's first Ctrl-C aborts it rather than killing the process); on abort the helper stops waiting without taking the lock and refuses `tick_locked` "interrupted while waiting for a running tick", exit busy (B9). Watch's clean-exit release passes no signal, because its signal has already fired; a second Ctrl-C hard-exits as today (B12).
- D6 **A holder that changes during the wait** (another person command took the lock, B10) is waited on within the same 60s budget, with no second wait line.
- D7 **Docs.** Rule H1 is already amended in refine. Implementation updates the docs that describe these commands' refusals (and the generated reference via `docs:emit` if any command help text changes) to say they wait up to 60s, and that `tick` and `migrate` refuse at once (B16).

### Testing decisions

Tests drive commands through `runCli` in the cli harness and observe only what a person or script sees: stdout, exit code, logged stderr lines, and files/refs on disk (B9's "nothing written"). They never call the new helper directly. Faked: the clock and the sleep (time), and the remote/runner ports as the harness already does. Not faked: the lock file, the liveness check (the test process is a real live holder; B8 uses a real reaped process), git. One thorough set of wait tests runs on one command (`tidy` or `story edit --at`), plus one short "waits, then runs" test per remaining command so a missed call site fails.

### Risks

- **The fake sleep orchestrating concurrent work (B5, B10).** Running a tick or a second command from inside the first command's sleep must not deadlock in-process. The first slice builds the helper with B2, B3, B7 on one command to prove the staging before the other items.
- **Ctrl-C in the real binary.** `main` turns the first signal into an abort for every command, so a command that ignores the signal would hang until a second Ctrl-C. D5 covers it; the slice that adds B9 should also be checked by hand once with the dev build in a throwaway repo.
- **Watch's exit-time release waiting up to 60s** may surprise a person who pressed Ctrl-C; the wait line says why, and a second Ctrl-C stops it.
