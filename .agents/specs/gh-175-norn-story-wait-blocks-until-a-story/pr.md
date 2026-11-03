## Summary

A supervisor (a person's script or an agent) can now block until a story reaches a state with `norn story wait <story|slice> --until <condition> [--timeout <d>]`. It prints that state as JSON and returns an exit code to branch on, so nobody has to grep `norn status` text for "done" again.

```text
norn story wait gh-64 --until gate --timeout 30m
  loop every --interval (5s)
    state   = waitState(projectView, key)     # @norn/view, pure, read only: ticks nothing
    matched = waitMet(state, until)           # step=<name> | gate | ask | stuck | done | merged
    matched     → print {met: true,  until, matched, waited_ms, state}; exit 0
    time is up  → print {met: false, …, state as it stands};             exit 7 (new ExitCode.timeout)
  bad --until / --timeout / --interval → exit 2 · unknown story or slice → exit 3
```

On a story, `gate`, `ask` and `stuck` also hold when one of its slices is in that state (`matched` names that unit). `step=` and `done` only look at the unit you name. `merged` holds once the PR is merged or the story status is `done`. The PR state is whatever the last sync tick saw. `done` means the round ended (`$done`). `sync.done`, `$done` and `not done` are not valid conditions and exit 2.

Two choices beyond the issue, flagged in review and kept on purpose:
- an extra `--interval <d>` flag (default 5s)
- a stop signal (SIGINT) exits 7, like a timeout, and still prints the state

## Evidence

The `quick` workflow has no QA step, so all evidence is tests. I ran both files on this branch: `packages/view/test/unit/wait.test.ts` (5 pass) and `packages/cli/test/integration/story-wait.test.ts` (7 pass). The command did not exist before.

- **`--until step=<name>`**
  **Before:** did not exist.
  **After:** `waitMet(story at review, step=review) == "gh-7"`, `step=implement → null`. Through the CLI, `wait gh-1 --until step=work` on a running unit gives exit 0, `waited_ms: 0` and no sleep.
- **`--until gate`**
  **Before:** did not exist.
  **After:** a slice parked at a gate meets `gate` on its story (`matched: "gh-7/01"`). In the CLI test the wait blocks while the agent reports and the tick moves the story to `review`, then returns exit 0 with `unit.status: parked, park.kind: gate`.
- **`--until ask`**
  **Before:** did not exist.
  **After:** a unit parked on an ask meets `ask`. A gate park does not count as an ask (unit test only).
- **`--until stuck`**
  **Before:** did not exist.
  **After:** a stuck unit meets `stuck` (unit test only).
- **`--until done` (round ended)**
  **Before:** a watcher's "done" pattern matched `sync → done` and stopped too early.
  **After:** the parser turns down `sync.done`, `$done`, `not done` and `Done` (exit 2 in the CLI). After `story approve`, `wait gh-1 --until done` returns exit 0 with `step: "$done"`. On a story, a done slice does not meet `done`.
- **`--until merged`**
  **Before:** did not exist.
  **After:** an open PR gives `null`. A merged PR, or a story with status `done`, gives `"gh-7"` (unit test only, so no real PR merge was observed).
- **Prints the state as JSON**
  **Before:** did not exist.
  **After:** the value is `{met, until, matched, waited_ms, state: {key, story, story_status, pr_state, pr_url, unit, slices}}` and contains only data.
- **Exit codes tell met / timed out / refused apart (P8)**
  **Before:** did not exist.
  **After:** met gives 0. `--timeout 12s --interval 5s` sleeps `[5000, 5000, 2000]`, then exits 7 with `met: false` and the current state. A bad condition or duration exits 2 with a `do_instead` that starts `norn story wait gh-1 --until`. `gh-9` and `gh-1/04` exit 3 with `code: "unknown_unit"`.

## Merge danger

**Door:** two-way. This adds a new command, but exit code 7 (`timeout`) is now part of the published `ExitCode` table in `docs/reference.md`, so taking it back means a supervisor's script loses it.

**Blast radius:** none for existing users: the command is new and read only (it never ticks, writes or claims). If it is wrong, a supervisor waits too long or stops on the wrong state. Not covered: asking for a `step=` that the unit's workflow does not have is accepted, and the wait then runs until `--timeout`.
