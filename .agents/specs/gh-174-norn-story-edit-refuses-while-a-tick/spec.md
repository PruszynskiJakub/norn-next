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
  - norn:wf:refinement
workflow: refinement
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
