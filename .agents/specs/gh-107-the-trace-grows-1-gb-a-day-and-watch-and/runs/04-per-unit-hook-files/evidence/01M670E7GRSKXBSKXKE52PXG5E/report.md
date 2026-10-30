# QA gh-107/04 at fde7724ad8b66a3f46d8d0a854900e612c0d573d
Suite and setup: suite.md, setup.md.

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| AC1 (B5) | pass | AC1.md, manual-out.txt, AC1-trace-events.md | identical line in hook file and day file; shown by `trace --events` |
| AC2 (B6) | pass | AC2.md, manual-out.txt | no trace file created or changed |
| AC3 (B7) | pass | AC3.md, manual-out.txt | |
| AC4 (B8) | pass | AC4.md, AC4-tick-*.json, AC4-tick-hooks.txt, slice-checks.txt | tick with unreadable day files: same decision, all 427 hook facts |
| AC5 (B9) | pass | AC5.md, AC45-out.txt | 3 blocks then allow, day files unreadable |
| AC6 (B10) | pass | AC6.md, AC6-*.json | brief output identical with unreadable day files |
| AC7 (B10) | pass | AC7.md, AC7-bench.json | brief 342 ms (2.15 GB) vs 455 ms (empty) |
