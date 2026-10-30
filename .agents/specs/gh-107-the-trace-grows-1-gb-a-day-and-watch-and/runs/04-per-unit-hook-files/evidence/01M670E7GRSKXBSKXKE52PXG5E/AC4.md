# AC4 (B8): pass
CLI: `norn tick --json` in the throwaway repo, once with the day files unreadable (chmod 200) and once readable.
- both exit 0, the same decisions `[{"unit":"gh-1","rule":"claim.unclaimed","kind":"noop","ok":true}]` (AC4-tick-wo.json, AC4-tick-readable.json; sync fails because the repo has no remote, both times);
- the facts each tick traced carry 427 hook facts for the live run, as many as the hook file holds (AC4-tick-hooks.txt). With the day files unreadable those can only have come from the hook file.
Tests: agent-protocol "B8 (D4)": gh-9 live, gh-10 done, hook lines for other units in hook files and day files. A tick within limits.stalled opens only gh-9's and gh-10's hook files and no day file (trace-read observer), and past the window only gh-9's. Observe snapshots and golden unchanged; all green (slice-checks.txt).
