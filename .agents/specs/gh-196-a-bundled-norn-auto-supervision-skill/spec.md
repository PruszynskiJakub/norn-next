---
id: gh-196
slug: a-bundled-norn-auto-supervision-skill
provider: gh
number: 196
url: https://github.com/PruszynskiJakub/norn-next/issues/196
title: A bundled norn-auto-supervision skill that drives stories from intake to merged PR unattended
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:refinement
workflow: refinement
status: new
intake_at: 2026-11-05T09:19:57.086Z
body_hash: a24d5b1a99594de075c2d340bff0e2a3ccff3f6bf637cc6fcc4a169b852db014
---

## Observed

A person who wants a story delivered end to end without watching it writes a long ad-hoc supervisor prompt (example below). It goes against norn's protocol: it spawns its own subagents to run `norn brief` for each step (which competes with the sessions norn's runner launches), picks steps by itself (code decides, not agents), names steps the story workflow does not have (`review`), and has the supervisor edit handoff.md in a live unit worktree. Every person rewrites this prompt, and each copy drifts from the protocol differently. Supervising several stories at once is harder still.

> You are the release supervisor for story gh-N… For each pending step (implement, test, review, QA, describe), spawn a subagent… If a test fails, rerun it alone three times, classify it as a flake only if it passes in isolation, record that in handoff.md… Stop and ask me only for spec ambiguity, destructive git operations or the final release approval. At the end, report the rounds run, the findings fixed, the flakes found, and the release version.

## Wanted

A bundled skill `norn-auto-supervision` (in `packages/cli/assets/skills/`, shipped by `norn init`) that tells an agent in the main checkout how to supervise one or more stories until they are merged, using norn's own commands only.

**Supervisor (top level, one per checkout)**
- Owns the one `norn watch` (or ticks) for the checkout. Never starts a second one and never starts step sessions or runs `norn brief`.
- Picks the stories to supervise (named ones, or every assigned `norn` issue taken in) and spawns one subagent per story.
- Is the only one that talks to the person: collects escalations from the subagents and passes them on one at a time, with the story named.
- Ends with one report covering every story.

**Per-story subagent**
- Loops on `norn story wait <story> --until gate|ask|stuck|done|merged`. Reads `norn status <story> --json` / `norn run view --json` and never matches text.
- On an `ask`: answers it (`norn story answer`) when the spec or the repo settles it. Otherwise escalates to the supervisor.
- On `stuck`: diagnoses it from the trace and the handoff, then retries or escalates with the reason.
- On a gate (`approve-slices`, `ready`, human QA): always the person's decision. Escalates with what they need to judge it.
- Escalates only for spec ambiguity, destructive git operations, gates and the release approval.
- Flaky tests: names where the rule lives (rerun alone N times, call it a flake only if it passes alone) and where it is recorded.
- Returns a report: rounds run (from receipts), findings fixed, flakes found, PR/merge state and, for `release`, the version.

## Open questions

- Should a story's supervision end at a merged PR, or at `ready` (a person merges)?
- Where does the flake rule live: in the `test` step's instructions or `norn-implement`, so the step agent records it, or only in the supervisor's report?
- Is a subagent allowed to answer asks itself, and to restart a stuck unit (`norn story edit --at`)? Which commands may it use?
- Which stories does the supervisor take: only named ones, or every assigned story? Does it cap how many run at once, or leave that to slots?
- How do escalations from several subagents reach the person: queued one by one, or batched?
- How does it hook into `release` (the version is judged at `ready`)?

## Where

- `packages/cli/assets/skills/` (new folder), `packages/cli/src/runtime/workflows.ts` (`bundledSkills`)
- `docs/reference.md` `norn story wait` (#175), `docs/recipes.md`, the two-watch limitation (#182)

## Rules

Touches the agent protocol (code decides the next step), claims/sessions launched by the runner, one watch per checkout, gates as a person's decision (S7, GR6, GR9). Refinement pins the exact ids.
