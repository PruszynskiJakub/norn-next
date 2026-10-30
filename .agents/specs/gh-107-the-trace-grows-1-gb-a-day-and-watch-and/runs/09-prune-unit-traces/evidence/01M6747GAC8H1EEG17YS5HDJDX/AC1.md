# AC1 (B28)
Real CLI, throwaway repo /var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa09/repo (`bun packages/cli/src/main.ts init`, NORN_HOME_DIR set), trace files aged with touch:
hooks/gh-3/_story.jsonl (40 B, 30d), hooks/gh-3/01.jsonl (10 B, 30d), hooks/gh-4/_story.jsonl (2d).
`tidy --json` -> trace.hook_files = [gh-3/01 10 B, gh-3 40 B]; afterwards hooks/gh-3/ is gone (emptied dir removed), hooks/gh-4 kept (see tidy1.json, after-tidy.txt).
Live unit (gh-9 running, started 20 days ago, hook file 20d old): needs a running unit, which only the harness gives offline: housekeeping.test.ts "…a live unit's are kept (B28)" asserts readState(gh-9).status === running, then hooks/gh-9/_story.jsonl kept and hook_files lists only gh-3. Passes (housekeeping.txt).
