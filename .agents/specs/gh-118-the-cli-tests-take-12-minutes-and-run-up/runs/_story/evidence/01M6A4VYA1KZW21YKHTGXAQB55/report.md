# QA #2, gh-118, one tier at a time on the maintainer's Mac
| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| B1 | pass | B1-B6-B20.md | bun test: 985 tests, 55 files, no integration/e2e |
| B2 | pass | B1-B6-B20.md | same 985/55 |
| B3 | pass | B3-unit-run1..3.log | ~2 s x3 |
| B4 | pass | B4-B14-16.log | guard message names the file, command and target folder |
| B5 | pass | B5-int-run1..3.log | 511/0 x3, ~111 s |
| B6 | pass | B6-e2e-run1..3.log | 72/0 x3, ~79 s |
| B7 | pass | static.md | |
| B8 | pass | static.md | |
| B9 | pass | static.md | |
| B10 | pass | static.md | |
| B11 | unverified | static.md | no PR/CI run yet |
| B12 | unverified | static.md | no PR/CI run yet |
| B13 | pass | static.md | |
| B14 | pass | B4-B14-16.log | |
| B15 | pass | B4-B14-16.log | |
| B16 | pass | B4-B14-16.log | |
| B17 | pass | B17.md | 1536 base names: 1534 in exactly one tier, 2 replaced on purpose; 34 added |
| B18 | pass | B18-B19.md | renames R100; golden adds 9 cases on both layouts (pre-existing on main); --update: 0 change |
| B19 | pass | B18-B19.md | harvest runs integration + e2e files; transcript rewrite leaves no diff |
| B20 | unverified | B1-B6-B20.md | local 3x green per tier; CI half not observable yet |
| B21 | pass | static.md, B21.log | QA#1 F2 fixed |
| B22 | unverified | timings.txt | no PR yet; measured numbers here |
