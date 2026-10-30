# AC5 (B9/A4): pass
Five `norn hook stop --agent claude` calls in gh-1's worktree (unattended auto step, run without a report), day files unreadable (chmod 200):
- #1–#3 `{"decision":"block","reason":"norn: step implement of gh-1 has no report for this run. …"}`; #4, #5 `{}` (MAX_STOP_BLOCKS = 3, A4). The hook file holds 3 `"blocked":true` lines. A failed read would be swallowed into `{}` from #1 on; it was not.
Test: agent-protocol AC5 (same answers as before at the limit, no day file opened), green. Output: AC45-out.txt.
