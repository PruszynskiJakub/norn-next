# QA gh-107/08 — trace retention (head 78650afb)

Throwaway repo: `/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa08/repo` (git init + this branch's `norn init`), CLI = `bun packages/cli/src/main.ts` via `n`.
Slice checks: `slice-checks.log` (31 pass, 0 fail); typecheck green (`typecheck.log`); full suite: `suite.log` (1253 pass, 0 fail).
Seeds: AC11 used 41 day files aged 0..40 with chunks files on even ages; AC1–AC10 used `seed.py` (46 days, ages 0..45). Today 2026-10-30 UTC.
The remote FAIL in doctor output comes from the throwaway repo having no `origin`; it is not part of this change.

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| AC1 (B23) | pass | AC1-4.txt | unset → 14d: 31 pruned, oldest kept 2026-10-16; 30d → 15 pruned, oldest kept 2026-09-30 |
| AC2 (B24) | pass | AC1-4.txt | config 14d + --retain 30d → oldest kept 2026-09-30 |
| AC3 (B25) | pass | AC1-4.txt | --retain 7d / config 7d → exit 3 retain_too_short, 46 day files left; doctor warning; `norn config trace` loads |
| AC4 (B26) | pass | AC1-4.txt, AC3-AC10.txt | --retain soon → exit 2 (usage); config soon → exit 3 retain_invalid; both name 14d, nothing deleted |
| AC5 (B27) | pass | AC11-tidy.txt | 26 oldest day pairs (39 files) gone, 15 days (ages 0..14) and workflows/ kept |
| AC6 (B31) | pass | AC11-dryrun.txt | 26 days with files+bytes, total 2,197,000; day files unchanged |
| AC7 (B32) | pass | AC11-tidy.txt | second tidy: trace {days: [], bytes: 0} |
| AC8 (B33) | pass | AC11-doctor.txt, AC11-tidy.txt | hint "26 days (2.2 MB) beyond trace.retain 14d — run norn tidy" under Hints, not a FAIL; none after tidy |
| AC9 (B34) | pass | AC9-AC10-extra.txt, slice-checks.log | 3 real ticks left all 46 day files; the 30-fake-clock-day test passes |
| AC10 (B20) | pass | AC10.txt, AC9-AC10-extra.txt | 40-day ulid + day gone → exit 3 tick_pruned "…older than the trace retained (14d)", do_instead `norn trace gh-1`; 3-day or day still present → no_tick |
| AC11 | pass | AC11-*.txt | hint 26 days / 2.2 MB = dry-run 26 days / 2,197,000 B = what tidy deleted |
