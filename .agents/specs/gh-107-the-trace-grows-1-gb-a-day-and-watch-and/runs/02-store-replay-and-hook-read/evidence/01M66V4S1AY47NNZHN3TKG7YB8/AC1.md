# AC1 (B18) — `norn why --tick` replays as before; golden corpus unchanged

Setup: throwaway git repo $TMPDIR/qa-107-02/repo with real recorded ticks copied from this machine's norn checkout trace
(30 tick lines: 20 from 2026-10-30, 10 from 2026-10-28, plus trace/workflows/). Base code = `git archive` of
gh-107-the-trace-grows-1-gb-a-day-and-watch-and (e83f5f1e) in basecode/; branch = this worktree (99045016).

Ran `bun <main.ts> why <unit> --tick <id> --json` for every (tick, unit) pair in those ticks, with both builds (ac1.ts).

Result: { pairs: 964, same: 964, diff: 0, exit codes base/branch: 0/0 = 894, 3/3 = 70 }
- every exit-0 replay reports replay matches = true (e.g. `01M66V6KMG6QVXK18A97HGXR7Q gh-117 exit 0 rule agent.ready.manual replay_matches true`)
- the exit-3 refusals are `no_replay` (ticks from 2026-10-28 recorded by an older norn without a replay block),
  identical on base: sample run in ac1-sample-branch.txt (56 exit 0 all matching, 5 no_replay).

Golden: `bun test packages/core/test/golden.test.ts` green (checks.txt); `git diff --name-only base...HEAD` touches no
golden case, transcript or observe snapshot (only golden-harvest.ts code, which now calls store readTickInputs).
Full suite: 1246 pass, 0 fail (full-suite.txt); typecheck clean.
