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
status: active
intake_at: 2026-10-30T15:03:08.086Z
body_hash: bce7c89165ae0fb6c873526503dec04972cfcd6437a50fe8cbd57a7f705db680
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
  Example: a test under `packages/store/test/unit/` that runs `git rev-parse HEAD` fails with a message like "unit test 'reads the head' started `git rev-parse HEAD`; a test that spawns belongs in test/integration/".

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

- B15 As a contributor, I want a unit test that imports the shared test helpers or store's git helpers to fail the repo rules, naming the file and the import, so that unit tests cannot reach real git by a side door.
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
