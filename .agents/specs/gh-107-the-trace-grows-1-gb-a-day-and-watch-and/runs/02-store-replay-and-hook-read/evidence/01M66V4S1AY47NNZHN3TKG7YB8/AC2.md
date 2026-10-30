# AC2 (B9) — `norn hook` at the blocked-hook limit (A4) answers as before

Differential scenario ac23.ts through runCli (the CLI entry) on the harness's real git repos, same steps on base
(basecode/) and branch code; outputs normalised (ulids, temp dir, shas, pids). Story gh-9 (duo, manual mode,
unattended implement step) after `norn brief` started its run; Stop hook (`norn hook stop`) fired five times:

stop9.0 block  "norn: step implement of gh-9 has no report for this run. ... report exactly once ..."
stop9.1 block
stop9.2 block
stop9.3 {}   <- limit (MAX_STOP_BLOCKS = 3) reached: allowed
stop9.4 {}
Attended gh-10 Stop x2: {} (never blocks, never counted).

Base vs branch: ac23-base.json vs ac23-branch.json differ only in `pid_start` (wall-clock start of the test process,
5 lines, ac23.diff); the summary of every hook answer, brief, tick decision and state is identical
(AC23-summary-base.txt == AC23-summary-branch.txt).
The blocked hooks of gh-10's run do not exist; hook facts of gh-10 in the trace did not change gh-9's count.
