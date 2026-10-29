# AC7 — removed verbs
AC7.txt: drop, inbox, cockpit, orient, open, answer, approve, unstick, update, mode, workflow, take, release, trace, why — each with `gh-1` and with `--json`: 30/30 exit 2, `{"error":"Unknown command: <verb>","do_instead":"norn help — commands: …","code":"unknown_command"}`. Repo snapshot (file list + refs + git status) hash identical before and after.
brief/done/ask/stuck observed working in the AC8 drive (exit 0 from the unit worktrees, AC8-drive.log); hook covered by the suite (agent-protocol tests).
