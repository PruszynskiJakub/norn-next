# AC1 (B11): first tick backfills a live run's 400 hook lines once
Probe: qa05.test.ts (harness: real `norn` CLI via runCli, real git, fake clock/remote), log qa05-probe.log.
- gh-9 live run (brief → tick, status running). Then the upgrade is simulated: backfill.json and gh-9's hook file deleted; 400 hook lines written old-style to day files 2099-01-15 (200, after run start) and 2099-01-16 (200). Added noise: a gh-9 line from before the run start, a duplicate copy of one line, a gh-404 line, a gh-9/01 slice line.
- Upgrade tick: opened day files 2099-01-15, 2099-01-16; hook file = 400 lines, 400 unique, exactly the run's lines in order (noise excluded); backfill.json `{since: <tick time>, done: ["gh-9"]}`.
- Second tick: opened day files `[]`; hook file byte-identical.
- Slice test `hook backfill on upgrade` AC1 passes (slice-tests.txt).
