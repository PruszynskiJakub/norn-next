# AC2 (B12): unfinished backfill + hook fired meanwhile → completes, each id once
Probe (qa05-probe.log): backfill.json rewritten with done: [] (same since), hook file cut to the first 150 copied lines; `norn hook post-tool-use` run in gh-9's worktree (exit 0) → 151 lines.
- Next tick: scanned both day files; hook file 401 lines, 401 unique; set = the 400 run lines + the live hook's id; done: ["gh-9"].
- Following tick: no day file opened, still 401 lines.
- Slice test AC2 passes.
