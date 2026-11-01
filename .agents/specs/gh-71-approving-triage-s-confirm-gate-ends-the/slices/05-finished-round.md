---
id: gh-71/05
title: $done ends the round, and the inbox says so
depends_on: [gh-71/04]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: test }
  - { id: AC7, verifier: test }
  - { id: AC8, verifier: agent }
---

## Goal
A story whose workflow reaches `$done` is a finished round, not a stranded story: with no PR it shows in the inbox among the items that need the person, with the next command; with an open PR it keeps the merge item; and a finished round is no longer parked for remote changes other than a PR closed unmerged.

## Scope
Behaviour: B2, B21, B24, B25, B26, B27, B35 (decide side). Seams: S1, S2. Decisions D5 (GR7 on a finished round, old parks read as finished), D6 (inbox item, rule id `story.round_done`). Out: starting the next round (06), GR6b closing (09).

## Acceptance
- AC1 (B2) Given a triage story waiting at `confirm`, when `norn story approve <story>` runs and the tick applies it, then the round is finished (`$done`) and the story is still active (spec not closed, worktree and claim kept). — verifier: test
- AC2 (B25) Given a finished round and no PR, when the inbox is built, then it holds a Your turn item "<story>: <workflow> round done, no PR" whose command is `norn story edit <story> --workflow <name>` with "or close the issue" as detail, and no "waiting for the PR merge (GR6)" item; decide's noop for it has rule id `story.round_done`. — verifier: test
- AC3 (B26) Given a finished triage round whose `explore` reported `story`, when the inbox is built, then the item still says `--workflow <name>`, not `--workflow story`. — verifier: test
- AC4 (B27) Given a finished round with an open PR, when the inbox is built, then it shows the merge item for that PR as today. — verifier: test
- AC5 (B21) Given a story in a later round (state `round: 3`) whose PR is merged into the base, when decide runs, then it emits `remote.pr_merged` cleanup as today. — verifier: test
- AC6 (B24) Given an unfinished round and an issue seen `closed`, when decide runs, then the story parks with `remote: issue closed` as today; given a finished round with a missing label, an unassigned issue or an unseen issue, then it is not parked (each is a Check item and the round stays finished); given a finished round whose PR was closed without a merge, then it parks as GR7 says. Every new rule id has a rule case, and changed golden decisions are rewritten with `golden --update`. — verifier: test
- AC7 (B35) Given a story an older norn left at `$done` parked as `remote`, when the holder's tick runs, then the park is dropped and the story reads as a finished round with the Your turn item of AC2. — verifier: test
- AC8 (B2, B25) Given a throwaway repo with a triage story at `confirm`, when the person approves with the build of this branch and runs `status`, then the story shows "triage round done, no PR" with the `--workflow <name>` command, among the items that need them. — verifier: agent

## Checks
- `bun test packages/core`
- `bun test --config=bunfig.integration.toml packages/cli/test/integration/runtime.test.ts packages/cli/test/integration/human.test.ts`
- `bun run test`
- `bun run typecheck`

## Notes
Ordered after 04 only so the slices run one at a time; it does not need 04: a finished round is read from the state as it is today (`$done`), and `round` absent means 1. Until 06 lands, the command in the item is refused on a `$done` story; that is fine on the branch, as nothing ships before the story's PR. The GR7-rewrites-`$done`-to-`stuck` bug is fixed here (D5).
