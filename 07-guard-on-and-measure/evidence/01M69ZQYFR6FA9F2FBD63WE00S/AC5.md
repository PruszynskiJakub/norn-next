# AC5 (B17) — pass (see note)
Per-test listing by junit (describe > name, file ignored, so moves don't count):
- Base = the story's main base 6b77e395b (the re-cut point, 22f0fb779), clean `git archive` copy, its own scripts: `test:fast` 975 tests in 52 files plus `test:cli --parallel` 553 tests in 45 files, **1,528** in total (AC5-base-fast.xml, AC5-base-cli.xml).
- Head: unit 983 + integration 505 + e2e 72 = **1,560** (AC5-head-{unit,int,e2e}.xml).
- Diff (AC5-diff.txt): **+34 added, −2 removed, 0 base tests lost**. Every added test is a repo rule (test/repo/repo.test.ts: B1/B2/B4, B5/B6, B7–B13, B14, B15, B16, B19, B21, the root dependency rules) or a guard self-test (test/repo/unit-guard.test.ts, 9). The 2 removed are replaced on purpose: "every adapter has its tests in packages/adapters/test/<adapter>/" became the unit/integration tier version, and "test:fast and test:cli split the suite" went with B7.
- 1,528 − 2 + 34 = 1,560. ✔
Note: 1,423 is the planning-time count (an older main). Main had 1,528 tests at the base this story was re-cut on, so the 105 between them are main's own tests, not this branch's.
