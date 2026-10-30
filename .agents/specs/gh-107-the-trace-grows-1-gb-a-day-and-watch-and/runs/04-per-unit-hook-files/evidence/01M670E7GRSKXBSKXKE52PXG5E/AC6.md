# AC6 (B10): pass
`norn brief --json` in gh-1's worktree, readable vs day files unreadable (chmod 200): both exit 0, outputs identical except the per-call `briefing` file id (AC6-brief-readable.json, AC6-brief-writeonly.json, AC6-out.txt). Today's day file gained one line, of type `briefing`: brief's own append, not a read. With `chmod 000` brief fails with EACCES on `open` of today's file, which is that append (the briefing event goes to the day trace, as before this slice).
Test: agent-protocol AC6 (only gh-9's hook file read, no day file), green.
