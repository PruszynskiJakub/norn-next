---
id: gh-75/11
title: story reopen undoes a close
depends_on: [gh-75/09, gh-75/10]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: agent }
---

## Goal
A close is not final: `norn story reopen` re-claims the story here, restores its worktrees from the pushed branches and puts every unit back at its step, with units that were running brought back stuck.

## Scope
Behaviour: B40, B41, B42, B55 (reopen). Seams: S1. Out: nothing else.

## Acceptance
- AC1 (B40) Given gh-N closed while slice 2 was at `review`, when `norn story reopen gh-N` is typed, then the worktrees are back, the claim is held here, `story.md` on the story branch says `active` (one commit), slice 2 is at `review`, and the next tick resumes it. — verifier: test
- AC2 (B41) Given slice 3 was running `implement` at close, after reopen it is stuck with reason `reopened` under Unblock (a `stuck` receipt by the person, D4) and the next tick does not start it; `norn run rerun` resumes it. — verifier: test
- AC3 (B42) `story reopen` on a story not closed → refused `not_closed`; a unit branch missing from the remote → refused naming the branch; issue #N closed on the remote → refused, do_instead "reopen the issue first"; all exit 3 and nothing changes. — verifier: test
- AC4 (B40) Given the base moved after the close, reopen restores the claim and worktrees only, and the next tick's base sync handles the rest without error. — verifier: test
- AC5 (B55) In a slice worktree that still exists for a closed story (or with the key given), reopen acts on the story; without a target, interactive, it offers closed stories only. — verifier: test
- AC6 (B40, B41) In a throwaway repo, close a story with a running slice and reopen it: worktrees, steps and the stuck unit look right in `norn status` and `story view`. — verifier: agent

## Checks
- `bun test packages/cli`
- `bun run typecheck`

## Notes
Reuses slice 10's restore module (prefactor 3) and slice 09's handling of a person's `stuck` receipt. Risk: reopen after a long gap (AC4). Where a closed story's units lived is read from the pushed story branch's `runs/`.
