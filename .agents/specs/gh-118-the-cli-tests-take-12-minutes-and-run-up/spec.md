---
id: gh-118
slug: the-cli-tests-take-12-minutes-and-run-up
provider: gh
number: 118
url: https://github.com/PruszynskiJakub/norn-next/issues/118
title: The cli tests take ~12 minutes and run up to three times per story
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:story
workflow: story
status: done
intake_at: 2026-10-30T15:03:08.086Z
body_hash: bce7c89165ae0fb6c873526503dec04972cfcd6437a50fe8cbd57a7f705db680
merge:
  pr: 140
  url: https://github.com/PruszynskiJakub/norn-next/pull/140
  head_sha: 1469a2adead769b6490a945ea6efa092752db5e3
  merge_commit_sha: 1cad40d86e05cc19354ddd41e71af9b3496eb9b7
  merged_by: PruszynskiJakub
  merged_at: 2026-11-01T00:14:28.000Z
---

# The cli tests take ~12 minutes and run up to three times per story

## Problem

The agent in `implement` must run the full suite before it hands back, and the full suite takes about 12 minutes on a 12-core Mac (630 s serial; the cli tests alone ~700 s file by file). A story pays for it up to three times: the agent's full run, the workflow's `test` check, and CI running the full suite again. The agent's run is the expensive one and CI repeats it, so every rework loop costs a quarter of an hour of waiting before anything new is learned.

The cost is not a few slow end-to-end files. It is spread over almost every cli test file, because every harness tick spawns real git (about 60 git processes per tick at ~19 ms each; one 33 s file starts 1,827 child processes, all git apart from 50 `ps` calls). Pure tests are fast: schema and core run 535 tests in under a second. They are just buried in the same run as the slow ones.

## Solution

Tests are split into three tiers by the folder they live in, and each tier is run by the reader who needs it:

- **unit**: in-process only. Temp files are fine; no child process (no git, no `ps`, no scripted CLIs). This is the suite an agent runs after every change, and a plain `bun test` runs it.
- **integration**: one package against real git, real processes or the cli harness. The workflow's `test` check runs it, after the unit tier and before the type check.
- **e2e**: multi-tick stories across the product, with the effect transcripts and observe snapshots. Only CI runs it, sharded.

A contributor or agent types `bun test` (or `bun run test`) and gets an answer in seconds. A red integration run in the `test` check sends the story back to `implement`; a red e2e run comes back through the existing `ci` check. CI runs the unit tier first and stops there when it is red; otherwise it runs integration and the e2e shards side by side.

The layout:

```
test/support/                 shared test helpers: cli harness, fake herdr, transcript, observe snapshot, golden harvest
test/repo/                    repo-wide rules and script tests (unit tier)
test/e2e/                     multi-tick stories, with their transcripts/ and observe-snapshots/
packages/<pkg>/test/unit/
packages/<pkg>/test/integration/
```

## Behaviour

- B1 As an agent in `implement`, I want `bun test` from the repo root to run only the unit tier, so that the command I am most likely to type is the fast one.
  Example: in a clean checkout, `bun test` runs the tests under every `test/unit/` folder and `test/repo/`, and none under `integration/` or `test/e2e/`; its summary lists no cli harness test.

- B2 As an agent or contributor, I want `bun run test` to run exactly what `bun test` runs, so that the two never disagree.
  Example: `bun test` and `bun run test` report the same number of tests and files.

- B3 As an agent, I want the unit tier to finish in under 30 seconds on the maintainer's Mac (12 cores, bun 1.3.13), so that I can run it after every change.
  Example: `time bun run test` on that machine reports under 30 s wall clock, all green.

- B4 As an author of a unit test, I want my test to fail when it starts a child process, with a message that names the test, the command it tried to start, and where the test belongs instead, so that the unit tier cannot slowly fill with git again.
  Example: a test 'reads the head' under `packages/store/test/unit/` that runs `git rev-parse HEAD` fails; bun reports `(fail) reads the head` with the guard's message beside it, like "unit test in packages/store/test/unit/x.test.ts started `git rev-parse HEAD`; a test that spawns belongs in test/integration/" (bun 1.3.13 gives a test no API for its own name, so bun's failure line names it).

- B5 As a contributor, I want `bun run test:integration` to run every integration test, in parallel, so that I can run the real-git tests on demand.
  Example: `bun run test:integration` runs the tests under every `packages/*/test/integration/` folder, and nothing else, and passes.

- B6 As a contributor, I want `bun run test:e2e` to run every e2e test, in parallel, so that I can reproduce a red e2e shard from CI locally.
  Example: `bun run test:e2e` runs the tests under `test/e2e/` (the slice workflow flow, base sync, claim lost, auto-recovery, observe snapshots, and whichever stories plan places there), and passes.

- B7 As a contributor, I want the old scripts `test:fast` and `test:cli` to be gone, so that no doc or workflow points at a split that no longer exists.
  Example: `bun run test:fast` fails with bun's "script not found"; nothing in the repo (docs, workflows, CI, skills) names either script.

- B8 As the workflow's `test` check (in `quick`, `story`, `slice` and `bug`), I want to run the unit tier, then the integration tier, then the type check, so that a story reaches review only when both local tiers and the types are green.
  Example: an integration test that fails makes the check fail, and the story goes back to `implement` as a red `test` check does today; a green unit and integration run with a type error also fails.

- B9 As an agent in `implement`, I want my brief's instructions to name `bun run test` as my loop, and not the full suite, so that I stop running integration and e2e before handing back.
  Example: the `implement` step's instructions in this repo's workflows say to run `bun run test` after each change, and say that integration runs in the `test` check and e2e in CI.

- B10 As an agent using the bundled `norn-implement` skill in any repo, I want it to ask for the repo's fast suite after each change, and not "the full suite green", so that slow tiers stay in their own check.
  Example: the shipped skill reads, in substance, "run the repo's fast suite after each change; slower tiers run in their own check".

- B11 As a reviewer of a PR, I want CI to run the unit tier and the type check first, and run the integration tier, the sharded e2e tier and the package build only when that passes, so that a broken unit test fails the run in seconds.
  Example: a PR with a red unit test shows the unit job red and the integration, e2e and package jobs skipped.

- B12 As a reviewer of a PR, I want the e2e tier split into shards that run side by side and stop together when one fails, so that the e2e tier does not set the CI wall clock alone.
  Example: CI shows several e2e jobs for one push; when one shard goes red, the others are cancelled.

- B13 As a person releasing norn, I want the release run (which tags and publishes) to run the unit tier and the type check only, because the release PR's CI already ran every tier on the same commit.
  Example: the release workflow's test step runs `bun run test` and the type check; it runs no integration or e2e test.

- B14 As a contributor, I want a test file outside a tier folder to fail the repo rules, naming the file, so that every test belongs to exactly one tier.
  Example: a new `packages/view/test/foo.test.ts` (not under `unit/` or `integration/`) makes the repo rules fail with "packages/view/test/foo.test.ts is not in a tier folder (unit/, integration/, test/e2e/, test/repo/)".

- B15 As a contributor, I want a unit test that imports the cli harness, the helpers that import it (transcript recorder, observe snapshot), or store's git functions to fail the repo rules (fake herdr and the golden harvest are pure and allowed), naming the file and the import, so that unit tests cannot reach real git by a side door.
  Example: `packages/cli/test/unit/x.test.ts` importing the cli harness fails the repo rules with the file and the harness import named.

- B16 As a contributor, I want only e2e tests to use the transcript and observe snapshot helpers, so that pinned effect outputs live in one tier.
  Example: an integration test that imports the transcript recorder fails the repo rules, naming the file.

- B17 As a contributor, I want a test file that mixes pure tests and real-git tests to be split into a unit file and an integration file, so that the pure part runs in the fast tier.
  Example: a store test file whose first half checks path parsing and second half runs `git` against a temp repo becomes `test/unit/…` with the parsing tests and `test/integration/…` with the git tests; no test is lost.

- B18 As a maintainer, I want the golden corpus, the effect transcripts and the observe snapshots to keep their content unchanged, only moved, so that the split is shown to change no behaviour.
  Example: the PR's diff of every transcript and snapshot file is a rename with no content change; `bun run golden` on the new layout adds no case and `bun run golden -- --update` changes no decision.

- B19 As a maintainer, I want rewriting transcripts and snapshots and harvesting golden cases to keep working from the new layout, so that the documented update commands still do what AGENTS.md says.
  Example: `NORN_TRANSCRIPT_UPDATE=1` on an e2e file rewrites its transcript in `test/e2e/transcripts/`; `bun run golden` harvests ticks from the integration and e2e harness tests.

- B20 As a maintainer, I want every tier to end green, including the two errors seen when the cli tests first ran in parallel, so that parallel runs are trusted.
  Example: `bun run test`, `bun run test:integration` and `bun run test:e2e` each pass three runs in a row on the maintainer's Mac and in CI.

- B21 As a contributor reading the docs, I want AGENTS.md and the README to describe the three tiers, the three commands, who runs which, and that a plain `bun test` is the unit tier only, so that nobody runs or asks for the old full suite.
  Example: AGENTS.md's Commands list `bun run test`, `bun run test:integration`, `bun run test:e2e`; its handback rule asks for the unit tier and the type check; the golden, transcript, snapshot and contract paths it names exist. The README's test line no longer says "all tests".

- B22 As a maintainer, I want the PR to report the measured times of the unit tier, the workflow `test` check and the CI wall clock next to the 702 s baseline, so that the gain is visible. Only the unit tier has a target (B3).
  Example: the PR description has a table: baseline 702 s cli / 630 s full serial; unit N s; `test` check N s; CI push-to-green N min.

## Out of scope

- Fewer git spawns per tick (batched ref reads, a per-tick cache): a product speed-up that changes the transcripts; its own story.
- A sweep that moves decide-level cli tests down into core as rule or golden cases: done only where a file is split anyway.
- A fake process port: profiling showed the pid probes are not the cost.
- Time targets for integration, e2e or CI: measured and reported (B22), not held to a number.
- The workflow templates shipped to other repos (slice, story, bug, whose check runs `bun test`): users replace that command with their own; only the bundled `norn-implement` skill changes (B10).
- A PRD change: this is repo tooling and AGENTS.md.

## Open questions

None. Left to plan: which of the 11–22-tick cli files (agent-protocol, team, records, audit, prompts, housekeeping, runtime, …) are e2e stories and which are integration commands; how cli tests import the root shared helpers under Bun's isolated linker and the dependency rule; the golden harvest and transcript update paths (B19); the e2e shard count (B12); the cause of the two parallel-run errors (B20).

## Plan

Status: agreed with the person in plan#1 (seams, prefactoring, decisions; B4's example and B15 amended).

Baseline measured while planning (maintainer's Mac, bun 1.3.13): everything outside the cli package, 948 tests in 52 files, 35.9 s serial; the cli package, 475 tests in 39 files, 146 s with 10 parallel workers. That makes 1,423 tests in 91 files, the count B17 is checked against. One parallel cli failure turned up: an integrate test timed out at bun's 5 s default because it builds its own repos without the harness, and the harness is what raises the limit to 20 s.

### Seams

- **S1 Repo rules, through the `test/repo` suite reading the repository's files** (package scripts, the bunfig files, workflow YAML, CI YAML, docs, skills, the test file tree and its imports). Observes B1, B2, B5–B16, B21.
  Prior art: repo rules' "test layout (AGENTS.md)" block (the test:fast/test:cli split test, which this replaces, and the per-adapter folder test), "quick and story wait for the PR's CI" (YAML parsed with Bun.YAML), the glossary and removed-command lints (live files vs records), the ratchet lints.
- **S2 Unit guard, through its preload interface**: the spawn functions it wraps, the error thrown at the call, and the per-test report that fails the test (it also fails when code under test swallows the error). Observes B4.
  Prior art: none. The planning spike proved the mechanism: a global `afterEach` registered in a preload fails the right test, and bun prints `(fail) <test name>` beside the guard's message.
- **S3 Golden script, through its exported functions** (which test files it harvests and the tier each one runs in). Observes B19.
  Prior art: the golden script's own tests (stableKey, selectNew, decisionChanges).
- **S4 The tier commands as a person runs them**: `bun test`, `bun run test`, `bun run test:integration`, `bun run test:e2e`, `bun run golden`, the transcript update. Observed by QA with recorded output. No automated test. Observes B3, B17, B18, B20.
- **S5 CI on the story's PR**, observed by QA on the PR's run and written into the PR body. Observes B22.

### Coverage

| Behaviour | Seam | Test kind | Notes |
|---|---|---|---|
| B1 | S1 | unit | root config ignores exactly `integration/` and `test/e2e/`; QA also runs `bun test` and reads the summary (S4) |
| B2 | S1 | unit | the `test` script is exactly `bun test` |
| B3 | S4 | e2e | `time bun run test`, three runs, all under 30 s |
| B4 | S2 | unit | a guard self-test spawns, takes the violation and checks the message; QA records one real failing unit test |
| B5 | S1 | unit | the integration script uses the integration config, runs in parallel and selects exactly `packages/*/test/integration/`; QA runs it (S4) |
| B6 | S1 | unit | same for e2e and `test/e2e/` |
| B7 | S1 | unit | lint: neither old script name appears in live files (scripts, docs, workflows, CI, skill sources and copies, tests); spec folders and `docs/audit-*` are records and exempt |
| B8 | S1 | unit | the four workflows' `test` check runs unit, then integration, then typecheck |
| B9 | S1 | unit | the implement steps in quick, story, slice and bug name `bun run test`, integration in the `test` check, e2e in CI |
| B10 | S1 | unit | the shipped norn-implement skill asks for the fast suite and no longer says "full suite" |
| B11 | S1 | unit | ci.yml: a unit + typecheck job; integration, e2e and package `need` it; QA sees it on the PR (S5) |
| B12 | S1 | unit | ci.yml: an e2e matrix over shards with fail-fast; QA sees it on the PR |
| B13 | S1 | unit | release.yml's test step runs exactly `bun run test` and the type check |
| B14 | S1 | unit | every `*.test.ts` sits under a tier folder; the message names the file |
| B15 | S1 | unit | unit tests import neither the spawning test helpers nor store's git functions |
| B16 | S1 | unit | only `test/e2e/` imports the transcript and observe snapshot helpers |
| B17 | S4 | e2e | the tier totals add up to 1,423 tests, give or take tests changed on purpose, with each change listed in the PR |
| B18 | S4 | e2e | the transcript/snapshot/golden diff is renames only (or no change); `bun run golden` adds nothing; `--update` changes nothing |
| B19 | S3 | unit | harvest discovery finds the harness test files in cli integration and `test/e2e/` and runs each with its tier's config; QA runs one transcript update (S4) |
| B20 | S4 | e2e | each tier three runs green locally; CI green on the PR |
| B21 | S1 | unit | AGENTS.md names the three commands, the handback rule and existing paths for golden, transcripts, snapshots and contracts; the README test line |
| B22 | S5 | e2e | the PR body's table |

### Prefactoring

1. **The root package declares the six workspace packages as dev dependencies, and the dependency rule extends to root `test/` and `scripts/`** (every `@norn/*` import there must be declared at the root). This lets the shared helpers move to `test/support/` and import `@norn/<pkg>` by name. A planning spike confirmed that a root helper and a package source get the same module instance through the isolated linker. Needed for the layout and for B15 and B16.
2. **The transcript, observe snapshot and golden harvest helpers name their output folders from the repo root, not from their own folder.** The helpers (moving to `test/support/`) and their pinned outputs (moving to `test/e2e/`) can then move separately and stay byte-identical. Needed for B18 and B19.

### Implementation decisions

- **D1 Tiers are chosen by bunfig.** The root bunfig is the unit tier: it preloads the guard and sets path-ignore patterns for `**/integration/**` and `test/e2e/**`. `test:integration` and `test:e2e` each run `bun test` with their own config file, which selects only that tier and turns on bun's built-in `--parallel`. An explicit path does not get past the root's ignore patterns (spike), so a second config per tier is required, not optional. Extra arguments pass through, so `bun run test:e2e <file>` runs one file.
- **D2 Unit guard.** The guard is a preload loaded only by the root bunfig. It wraps `Bun.spawn` and `Bun.spawnSync`; node's `child_process.spawn` goes through them (spike), and nothing in the repo uses node's sync or exec forms. A blocked call throws at once, and a global `afterEach` fails the test even when the code under test catches the error. The message names the command's argv and the test file, and says the test belongs in `test/integration/`. It never prints the environment: a spike that printed the spawn options leaked the whole env, secrets included, which in CI would land in logs. Bun 1.3.13 has no current-test-name API, so bun's own `(fail) <name>` line, printed with the message, is what names the test. Amend B4's example to say so.
- **D3 Shared helpers.** `test/support/` holds the cli harness, fake herdr, the transcript recorder, the observe snapshot helpers and the golden harvest. Package-local helpers stay at their package's test root, outside the tier folders, because both tiers share them: store's tmp helpers, core's fixtures and rule cases, the adapters' contract suites, and fixtures. Root test code imports `@norn/<pkg>` for public API and the cli's internals through a relative path into the cli's sources, as the golden script does today. Package tests import `test/support/` through a relative path.
- **D4 e2e membership.** A file is e2e when its tests carry one story across several steps or clones, or pin effects. That covers the slice workflow flow (renamed from `e2e.test` to say what it is), base sync, claim lost (recovery), auto-recovery, observe snapshots and team (two clones hand one story over). The other harness files are cli integration even at 11–22 ticks, because each of their tests checks one command or rule: agent-protocol, records, audit, prompts, housekeeping, runtime, criteria and the rest. Integration runs in the local `test` check and e2e only in CI, so this keeps the local catch wide.
- **D5 Unit membership by the guard.** A file moves to `unit/` only when it passes under the guard. Mixed files are split (B17). From the planning spawn log: adapters git and contract, store refs, spawn, snapshot, worktree, defects, leases-lock and files, view's view and steps, cli integrate and strays, and every harness file are integration or split. Schema, core, view cockpit, the fixture-based adapter tests, cli assets, defects and detect (if they pass the guard) and the script tests are unit.
- **D6 Root `test/`.** `test/repo/` takes the repo rules, the process-setup test and the script tests (process check, golden). The herdr plugin test, which runs `next.sh` through `sh`, leaves the repo rules for cli integration, because the plugin drives the cli and a unit tier cannot spawn. Per-adapter subfolders carry on inside each tier (`unit/<adapter>/`, `integration/<adapter>/`), and fixtures move with their tests. The rule "every adapter has tests" reads both tiers.
- **D7 Timeouts.** Integration and e2e run with a 20 s default per-test timeout from their tier config or command, the value the harness already sets for its own tests. This fixes the planning failure: tests that spawn git without the harness keep bun's 5 s and time out under parallel load.
- **D8 Workflow `test` check.** quick, story, slice and bug run `bun install --frozen-lockfile && bun run test && bun run test:integration && bun run typecheck`, with the 15 m timeout unchanged. The comments in quick.yaml and story.yaml that name test:fast are rewritten.
- **D9 Implement instructions and skill.** The implement step of each repo workflow says to run `bun run test` after each change, with integration in the `test` check and e2e in CI. The shipped norn-implement skill's loop line and Done line say to run the repo's fast suite after each change and that slower tiers run in their own check. Only the asset source is edited; the repo copy refreshes on the next `norn init` (AGENTS.md). norn-merge's "full suite passes" stays: it is not in B10, and it now means the unit tier.
- **D10 CI.** Job `unit` runs `bun run test` and the typecheck. Then `integration` (one job, parallel inside), `e2e` (a 3-shard matrix through bun's `--shard`, with `fail-fast: true` so a red shard cancels the others) and `package` all need `unit`. Git identity is set in each job that spawns git. Three shards because there are six e2e files and bun shards by file. QA's measurement may change the number without reopening the plan.
- **D11 Release.** The release build's test step runs `bun run test` and the typecheck, and nothing else.
- **D12 Golden and transcripts.** The golden script harvests from the harness test files in cli integration and in `test/e2e/`, and runs each with its tier's config, so the root ignore patterns do not hide them. The corpus stays at core's test root (golden.test is unit). Transcripts and snapshots move to `test/e2e/transcripts/` and `test/e2e/observe-snapshots/`. The documented rewrite becomes `NORN_TRANSCRIPT_UPDATE=1 bun run test:e2e <file>`.
- **D13 Banned imports in unit tests (B15).** Banned: the cli harness, plus the transcript and observe snapshot helpers, which import it, and store's git functions. Fake herdr and the golden harvest stay allowed, because they are pure. Amend B15 to name the banned list instead of "the shared test helpers".
- **D14 B7 lint scope.** Live files only: package scripts, AGENTS.md, README, CONTRIBUTING, `.agents/workflows`, `.github`, skill sources and copies, `scripts/`, and tests. Spec folders and `docs/audit-*` are records of past work and are exempt, as in the removed-command lint.

### Testing decisions

A test here asserts what a reader of the repo or a runner of a command sees: the files' declared configuration (S1), the guard's observable failure (S2) and the golden script's chosen files and commands (S3). Never internals. Repo-rule tests parse the real files of this checkout and fail naming the offending file. No new fakes. The tier moves keep every existing test's assertions as they are; a move that seems to need a changed assertion is a finding for the PR, not a quiet edit. Measurements (B3, B17, B18, B20, B22) are QA evidence through S4 and S5, recorded in the criteria report and the PR body.

### Risks

- **The second parallel-run error (B20) is not yet known.** The planning run found one (the 5 s timeout, D7). The first slice runs integration and e2e in parallel three times before moving anything else, so a second cause turns up early.
- **Hidden spawns in tests that look pure.** cli code paths can call `ps` (brief), `lsof` (strays) or `git remote` (detect), including at module load. The guard finds them, and the file moves or splits; D5's list is a starting point, not settled.
- **The size of the move.** Around 90 files change folder in one PR. Slicing should keep each slice green and moves free of content changes, so review reads renames.
- **bun shards by file count, not time.** The e2e shards may be unbalanced. Measured and reported (B22), and the shard count may change (D10).
- **The local `test` check gets longer.** It goes from about 30 s to unit plus parallel integration, estimated at 2–3 minutes against the 15 m timeout. Measured (B22).
