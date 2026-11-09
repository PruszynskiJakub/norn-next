---
id: gh-301/08
title: norn-review rewritten to the exact-versus-principled rule
depends_on: []
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: agent }
---

## Goal
The contributor docs state when a bundled skill must be exact and when it gives principles; `norn-review` is rewritten to that rule, keeping its contracts and giving any command-running subagent the rules its work can break; a comparison on past diffs shows the rewrite loses nothing.

## Scope
User stories: the exact-versus-principled rule in the contributor docs; `norn-review` rewritten to it, contracts kept; `norn-review` gives command-running subagents their rules; the rewrite shown to lose nothing on past diffs. Seams: S5. Decisions D13 (Development › Skills), D14, D17. Out: rewriting other skills (out of scope); `norn-retro` (gh-301/10); dropped protocol lines (gh-301/09).

## Acceptance
- AC1 Given Development › Skills, then it says a skill is exact where code reads what the agent produces (report outcomes, the criteria and findings JSON) or where it is tuned to the agent tool (such as `norn-fsd-round`'s timeouts), and everywhere else states the failure it prevents and the outcome to reach, gives principles with their reasons, and keeps numbered steps only where order matters; the docs lint passes. — verifier: test
- AC2 Given the rewritten `norn-review` source, then it still holds the two axes judged apart, the traceability table, the findings JSON with its blocking flag, the checks of blocking findings and `REVIEW.md`'s precedence, and no longer holds word-for-word subagent prompts or word caps, as pinned by terms in the assets test. — verifier: test
- AC3 Given the rewritten `norn-review`, then it tells any subagent that runs commands (an axis running the suite, a check of a blocking finding trying the input) no push, no branch or worktree switch, no norn command and no writes under run state, each with its reason. — verifier: test
- AC4 Given two past diffs from merged stories' delivery records, one whose review raised a blocking finding that held and was fixed in rework and one that review passed clean, when the old and the new `norn-review` each review both, then the new one raises the same defect (wording may differ) on the first and no blocking finding on the second; non-blocking differences are noted; both outputs are in the step's evidence for the PR's before/after. — verifier: agent

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
Edit the skill at `packages/cli/assets/skills/norn-review/`, never its `.agents/skills` copy. AC4 is QA by an agent; Jakub judges the comparison at the PR (D17). Pick the past diffs from `.agents/specs/*/reviews` and their rework receipts.
