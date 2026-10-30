# AC3 (B7): pass
Ran `norn hook session-start --agent claude` (Claude SessionStart, source startup; no NORN_RUN in env) in gh-1's worktree → `{}` exit 0.
- hook file 421 → 422 lines; new line `{"type":"hook",…,"fact":{"event":"session_start",…,"native":"SessionStart",…,"message":"startup","story":"gh-1","run_id":"01M66CKKZSK12P2CXYHTSJJNPP"}}` (norn attaches the unit's live run; the payload carries none). `norn trace gh-1 --events` shows `hook claude session_start startup`.
Test: agent-protocol AC3, green. Output: manual-out.txt.
