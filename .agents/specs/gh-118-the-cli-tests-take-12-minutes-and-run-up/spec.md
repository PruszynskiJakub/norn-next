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
status: new
intake_at: 2026-10-30T15:03:08.086Z
body_hash: 7f5afd51522b48ecf3df760be4ba9ee1a1c7f0478e656583caf712bb4d7ddcb9
---

## Observed

`bun test` is the suite the `implement` agent must run before handing back (AGENTS.md:28). It takes about 12 minutes, and `packages/cli/test` is nearly all of that. One story runs the tests up to three times: the agent runs the full suite in `implement`, the `test` check runs `test:fast` + typecheck after `update`, and CI runs the full suite again. The agent's full run is the expensive one, and CI repeats it.

Each cli test file run on its own (macOS, bun 1.3.13): **702 s total**.

- Flow files: `base-sync` 101 s, `auto-recovery` 36, `recovery` 30, `e2e` 23, `observe-snapshots` 22. Together 212 s, about 30%.
- Ordinary command files are slow too: `human` 51, `run-rerun-cancel` 47, `team` 34, `prompts` 34, `story-reopen` 31, `story-decision` 29. Only ~10 of 39 files take under 5 s.
- The slowest files have no sleeps. The cost tracks `h.tick()` calls at roughly 2–3 s per tick (`base-sync`: 34 ticks in 101 s; `run-rerun-cancel`: 29 ticks in 47 s).

So the cost is per tick (real git, `ps`/`lsof` pid probes, the fakes), and it is spread over almost every cli file. A few e2e files alone don't explain it.

## Wanted

A fast default suite that an agent can run on every change, with the slow flows run once, in CI. In order, each step measured against the 702 s baseline:

1. **Profile one harness tick.** Count spawns with `setSpawnObserver` and time each kind, to find what dominates (pid probes, git, fetch against the bare remote).
2. **Make a tick cheap in tests.** Possible fixes: a fake process port held to `processContract`, a template repo built once and copied per test, a shared bare remote, no fetch when nothing moved.
3. **Run independent cli tests concurrently** (`test.concurrent` / `--concurrent`). Check the shared `~/.norn` and the process-wide spawn observer first.
4. **Split cli tests by tier.** `packages/cli/test/command/` holds one command or one tick. `packages/cli/test/flow/` holds multi-tick stories, transcripts and observe snapshots, with their pinned outputs. `bun run test` ignores `flow/`, `bun run test:flow` runs it, and CI runs everything with `flow/` sharded (`--shard`). A `test/repo.test.ts` rule keeps transcript, snapshot and multi-tick helpers inside `flow/`.
5. **Move tests down.** A cli test whose assertion is really "decide picks X" becomes a rule or golden case in core.
6. **Update the docs and workflows to match.** AGENTS.md (Commands, "full suite before handback") asks for `bun run test` plus the flow tests for the area touched. The `test` check in `quick.yaml`/`story.yaml` uses the same script, and `test:fast`/`test:cli` go away.

Steps 1–4 keep behaviour: the golden corpus, transcripts and snapshots don't change, apart from moving.

## Where

- `package.json:7-9`: `test`, `test:fast`, `test:cli`
- `packages/cli/test/harness.ts:253` (`createHarness`), `:301` (`tick`)
- `.agents/norn/workflows/quick.yaml` and `story.yaml:65`: the `test` check
- `.github/workflows/ci.yml:32`: `bun test`
- `AGENTS.md:28`: the full-suite rule for handback
- `test/repo.test.ts:117`: the test layout rules

## PRD

X4 (core tested by replaying traces), which is what step 5 leans on. No PRD change is expected; this is repo tooling and AGENTS.md.
