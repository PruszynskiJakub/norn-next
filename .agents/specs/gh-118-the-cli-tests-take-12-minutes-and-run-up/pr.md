## Summary

Tests are split into three tiers by folder. A plain `bun test` now runs only the **unit** tier: about 2 s, where it used to run the whole ~12 min suite. The workflow's `test` check runs unit, then **integration**, then the type check. **e2e** runs only in CI, in 3 shards, and only after the unit job passes. A preload makes any unit test that starts a child process fail.

```text
test/support/                 shared helpers (cli harness, fake herdr, transcript, observe snapshot, golden harvest, unit guard)
test/repo/                    repo rules + script tests            → unit
test/e2e/                     multi-tick stories, transcripts/, observe-snapshots/ → e2e (CI only, 3 shards)
packages/<pkg>/test/unit/     in-process, guarded: no spawn        → `bun test` = `bun run test`
packages/<pkg>/test/integration/  real git, processes, cli harness → `bun run test:integration` (workflow test check)
```

```diff
 bunfig.toml        preload unit guard; ignore **/integration/**, test/e2e/**
 package.json
-  test:fast, test:cli
+  test             = bun test
+  test:integration = bun test --config=bunfig.integration.toml --parallel --timeout=20000
+  test:e2e         = bun test --config=bunfig.e2e.toml --parallel --timeout=20000
 ci.yml
-  check: bun test, typecheck  |  package
+  unit: bun run test, typecheck
+    → integration | e2e (shard 1..3, fail-fast) | package     (all `needs: unit`)
```

Measured on the maintainer's Mac (12 cores, bun 1.3.13), one tier at a time ([timings.txt](https://github.com/PruszynskiJakub/norn-next/blob/gh-118-the-cli-tests-take-12-minutes-and-run-up/.agents/specs/gh-118-the-cli-tests-take-12-minutes-and-run-up/runs/_story/evidence/01M6A4VYA1KZW21YKHTGXAQB55/timings.txt)):

| | Before | After |
|---|---|---|
| Agent's loop (`bun test`) | full suite: 702 s cli / 630 s full serial | **unit: ~2 s** (985 tests) |
| Workflow `test` check | ~30 s (test:fast) | unit 2 s + integration ~111 s + typecheck 5 s ≈ **2 min** |
| e2e (local, for reference) | in the full suite | ~79 s (72 tests) |
| CI push-to-green | — | not measured yet: there was no PR when QA ran (see B22) |

## Evidence

QA evidence is in [`runs/_story/evidence/01M6A4VYA1KZW21YKHTGXAQB55/`](https://github.com/PruszynskiJakub/norn-next/tree/gh-118-the-cli-tests-take-12-minutes-and-run-up/.agents/specs/gh-118-the-cli-tests-take-12-minutes-and-run-up/runs/_story/evidence/01M6A4VYA1KZW21YKHTGXAQB55) (qa#2, on 2af68a98b). Files named below are in that folder.

- **B1** `bun test` runs only the unit tier
  **Before:** ran every test, cli harness included.
  **After:** 985 pass / 0 fail across 55 files. The JUnit list has no file under `integration/` or `test/e2e/` and no harness test ([B1-B6-B20.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-118-the-cli-tests-take-12-minutes-and-run-up/.agents/specs/gh-118-the-cli-tests-take-12-minutes-and-run-up/runs/_story/evidence/01M6A4VYA1KZW21YKHTGXAQB55/B1-B6-B20.md), `bun-test.log`, `B17-unit.xml`). A repo rule asserts the root bunfig ignores exactly those two folders.
- **B2** `bun run test` runs the same thing as `bun test`
  **Before:** both ran the whole suite (`test` was already `bun test`).
  **After:** the script is still exactly `bun test`, which a repo rule now checks. Both give 985 tests in 55 files.
- **B3** unit tier under 30 s
  **Before:** did not exist (the full suite took ~12 min).
  **After:** `time bun run test` took 1.98 s, ~2 s and ~2 s, all green (`B3-unit-run1..3.log`).
- **B4** a unit test that spawns fails, with the test, the command and where it belongs
  **Before:** did not exist.
  **After:** a probe test in `packages/store/test/unit/` ran `git rev-parse HEAD`. Output: `(fail) reads the head` with `unit test in packages/store/test/unit/qa-probe.test.ts started \`git rev-parse HEAD\`; a test that spawns belongs in test/integration/`. A probe that swallows the error also fails ([B4-B14-16.log](https://github.com/PruszynskiJakub/norn-next/blob/gh-118-the-cli-tests-take-12-minutes-and-run-up/.agents/specs/gh-118-the-cli-tests-take-12-minutes-and-run-up/runs/_story/evidence/01M6A4VYA1KZW21YKHTGXAQB55/B4-B14-16.log)). The guard's self-tests (`test/repo/unit-guard.test.ts`) also check that the message never includes the environment.
- **B5** `bun run test:integration` runs every integration test in parallel
  **Before:** did not exist.
  **After:** 511 pass / 0 fail across 53 files, 3 runs: 111.8 s, 111.4 s, 110.0 s. Only `packages/*/test/integration/` is selected (`B5-int-run1..3.log`, `B17-int.xml`).
- **B6** `bun run test:e2e` runs every e2e test in parallel
  **Before:** did not exist.
  **After:** 72 pass / 0 fail across 7 files, 3 runs: 78.5 s, 78.4 s, 80.0 s. `bun run test:e2e test/e2e/base-sync.test.ts` runs that one file (`B6-e2e-run1..3.log`, `B19-transcript.log`).
- **B7** `test:fast` and `test:cli` are gone
  **Before:** both existed and docs, workflows and CI named them.
  **After:** both fail with "Script not found". `git grep` finds no match in live files; only records under `.agents/specs/` mention them ([static.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-118-the-cli-tests-take-12-minutes-and-run-up/.agents/specs/gh-118-the-cli-tests-take-12-minutes-and-run-up/runs/_story/evidence/01M6A4VYA1KZW21YKHTGXAQB55/static.md)). A repo rule lints this.
- **B8** workflow `test` check runs unit → integration → typecheck
  **Before:** `bun run test:fast` and the type check.
  **After:** the check in bug/quick/slice/story is `bun install --frozen-lockfile && bun run test && bun run test:integration && bun run typecheck` (static.md, repo rule AC2).
- **B9** implement instructions name `bun run test` as the loop
  **Before:** named no test command for the agent's loop; AGENTS.md's handback rule asked for the full suite.
  **After:** all four workflows say to run `bun run test` after each change, with integration in the `test` check and e2e in CI (static.md, repo rule AC3).
- **B10** the shipped `norn-implement` skill asks for the fast suite
  **Before:** "the full suite green".
  **After:** `packages/cli/assets/skills/norn-implement/SKILL.md:20` says "the repo's fast suite after each change. Slower tiers … run in their own check". "full suite" no longer appears (static.md, repo rule AC4).
- **B11** CI runs unit + typecheck first; the other jobs wait for it
  **Before:** one `check` job ran everything.
  **After:** in `ci.yml`, integration, e2e and package all have `needs: unit`, and a repo rule (AC5) asserts it. **Not observed on a run:** there was no PR when QA ran. To check: on this PR's CI, unit runs alone first. Pushing a red unit test shows the other jobs skipped.
- **B12** e2e in shards that stop together
  **Before:** no shards.
  **After:** `ci.yml` has a matrix over shards `[1, 2, 3]` with `fail-fast: true`, running `bun run test:e2e --shard=N/3` (repo rule AC5). **Not observed on a run**, for the same reason. To check: this PR's CI shows three `e2e (shard N/3)` jobs.
- **B13** release run tests only unit + typecheck
  **Before:** ran `bun test` (everything).
  **After:** the test step in `release.yml` runs `bun run test` and `bun run typecheck` only (static.md, repo rule AC6).
- **B14** a test file outside a tier folder fails the repo rules
  **Before:** did not exist.
  **After:** a probe `packages/view/test/foo.test.ts` fails with `packages/view/test/foo.test.ts is not in a tier folder (unit/, integration/, test/e2e/, test/repo/)` (B4-B14-16.log).
- **B15** unit tests cannot import the harness, the helpers that import it, or store's git functions
  **Before:** did not exist.
  **After:** a probe `packages/cli/test/unit/qa-x.test.ts` that imports the harness fails the rule, which names the file and the import (B4-B14-16.log).
- **B16** only e2e uses the transcript and snapshot helpers
  **Before:** did not exist.
  **After:** a probe integration test that imports the transcript recorder fails the rule, which names the file (B4-B14-16.log).
- **B17** no test lost in the split
  **Before:** 1536 tests on merge base a39ba103e.
  **After:** 985 unit + 511 integration + 72 e2e = 1568, and no name appears in more than one tier. 34 tests are new: repo rules, guard self-tests, golden discovery, pinned-output paths. 2 were replaced on purpose: the old `test:fast`/`test:cli` split rule and the old adapter-folder rule ([B17.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-118-the-cli-tests-take-12-minutes-and-run-up/.agents/specs/gh-118-the-cli-tests-take-12-minutes-and-run-up/runs/_story/evidence/01M6A4VYA1KZW21YKHTGXAQB55/B17.md)). No existing test's assertions were changed by a move.
- **B18** golden corpus, transcripts and snapshots unchanged
  **Before:** under `packages/cli/test/`.
  **After:** every transcript and snapshot is an `R100` rename into `test/e2e/`. `bun run golden -- --update` reports "0 of 102 golden case(s) decide differently now". `bun run golden` adds 9 cases, but it adds the same 9 (same names) on the merge base's old layout too. So the corpus was already short on main, and the split does not change what is harvested. The 9 were not committed ([B18-B19.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-118-the-cli-tests-take-12-minutes-and-run-up/.agents/specs/gh-118-the-cli-tests-take-12-minutes-and-run-up/runs/_story/evidence/01M6A4VYA1KZW21YKHTGXAQB55/B18-B19.md), `B18-base-golden.log`).
- **B19** update commands work from the new layout
  **Before:** `NORN_TRANSCRIPT_UPDATE=1 bun test <file>` under `packages/cli/test/`.
  **After:** `NORN_TRANSCRIPT_UPDATE=1 bun run test:e2e test/e2e/base-sync.test.ts` rewrites in place with no diff. `bun run golden` harvests from cli integration and `test/e2e/`, each run with its tier's config (B18-B19.md, `B19-transcript.log`, `test/repo/golden.test.ts`).
- **B20** every tier green, three runs in a row
  **Before:** cli tests in parallel hit two errors, one of them an integrate test timing out at bun's 5 s default.
  **After (local):** each tier ran 3 times on the maintainer's Mac, one tier at a time: unit 3/3, integration 3/3, e2e 3/3 green, and typecheck passed. Integration and e2e now default to a 20 s timeout. **CI half not observed:** there was no PR. To check: this PR's CI is green on every job, and stays green when re-run twice. Running two integration tiers at once on one machine (24 workers on 12 cores) still times out hooks. The person ruled that is load, not a bug, so run one tier at a time.
- **B21** AGENTS.md and README describe the tiers
  **Before:** "all tests" and `test:fast`/`test:cli`.
  **After:** AGENTS.md's Commands list the three commands. The handback rule asks for the unit tier and the type check. Every path it names for golden, transcripts, snapshots and contracts exists, which repo rule AC7 asserts. The README's test line no longer says "all tests" ([B21.log](https://github.com/PruszynskiJakub/norn-next/blob/gh-118-the-cli-tests-take-12-minutes-and-run-up/.agents/specs/gh-118-the-cli-tests-take-12-minutes-and-run-up/runs/_story/evidence/01M6A4VYA1KZW21YKHTGXAQB55/B21.log)). Not fixed here: AGENTS.md's Rules section still gives adapter fixtures as `packages/adapters/test/<adapter>/`. They now live in `test/unit/<adapter>/`. B21 does not list that path.
- **B22** measured times next to the baseline
  **After:** the table in the Summary gives the unit tier and the `test` check. **CI push-to-green is not shown yet:** it needs this PR's first green run. Add it to the table then.

## Merge danger

**Door:** two-way: a revert puts every file back, and no data, published format or API changes. The golden corpus, transcripts and snapshots are byte-identical renames.

**Blast radius:** contributors and CI. Commands change: `test:fast` and `test:cli` are gone, and a plain `bun test` no longer runs integration or e2e. Open branches that add tests at the old paths now fail the tier-folder rule (B14) until they move them. A unit already running keeps its pinned workflow (S7). If its pinned `test` check calls `bun run test:fast`, that check fails once its branch takes this change. The local `test` check grows from ~30 s to ~2 min, well under its 15 min timeout.
