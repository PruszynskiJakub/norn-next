# QA #4 live checks at 7846c9dd8

Dev build (`bun packages/cli/src/main.ts`), lab under a scratch TMPDIR with its own NORN_HOME_DIR, dashboard on 127.0.0.1:61847, `watch --interval 2s` in the lab repo.

1. `norn lab --port 61847` printed the dashboard URL and built the lab; the watcher played beats 1-2 and parked at beat 3 ("The agent asks you"), `next: norn story answer lt-1 "<answer>"` (live/state-beat3.json, live/watch.log).
2. Answer button: refused `person_only` (exit 3) through ancestor process: this agent session (live/answer.json). Person-only beats can't be played below an agent session; not bypassed.
3. Reset: `norn lab --clean`, exit 0, rebuilt at beat 1 (live/reset.json).
4. Kill pressed while implement's agent ran: `kill -s KILL -- -77418`, exit 0, way out names `agent.died.retry` (live/act-kill.json). Next tick decided `agent.died.retry`, a fresh session ran, the check ran and the lab reached beat 3 again: not stuck (live/state-after-kill.json decisions; live/watch.log 19:23:55-19:24:06).

~/.norn listing and this worktree unchanged (git status clean). Lab processes stopped.

CI at edd288edd (PR #518's head; only 7846c9dd8 after it, diff-since-qa3.txt): shard 2 passed every 08 lab-play test (AC1-AC13), the dashboard test and the --tty test; it failed only the break-it test with "nothing to commit", the cause 7846c9dd8 fixes (ci-edd288edd-shard2.txt). CI has not yet run on 7846c9dd8.
