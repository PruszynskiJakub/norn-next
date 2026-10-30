# AC3 (B10) — brief with hook facts of two units; tick decides the same

Same differential scenario (ac23.ts). Hook facts of two units in the trace, interleaved:
PreToolUse in gh-9's worktree (session sess-nine), in gh-10's (sess-ten), in gh-9's again (sess-nine-later).
Then `norn brief` in each worktree:

started9  agent_session_id = sess-nine-later, worktree = .../gh-9-manual-thing
started10 agent_session_id = sess-ten,        worktree = .../gh-10-pair-on-it
After the tick: gh-9 running sess-nine-later, gh-10 running sess-ten.

Every tick's decisions (rules per unit) over the whole scenario, the brief markdown of both units, inbox JSON and
`why` for both units are identical on base and branch (only pid_start wall-clock differs; ac23.diff).
Pins: observe-snapshots.test.ts, e2e/base-sync/recovery (effect transcripts) green, and the diff changes no file
under packages/cli/test/transcripts/ or packages/cli/test/observe-snapshots/ (checks.txt).
