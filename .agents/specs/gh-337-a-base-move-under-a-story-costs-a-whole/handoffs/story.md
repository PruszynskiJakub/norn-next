# gh-337 — handoff

## Goal

Make a base move under a story cheap, automatic and reviewable, and make each rework loop cost one CI run: all nine changes from the issue, in this one story.

## Proof

- spec.md: Problem Statement, Solution, 76 user stories, Out of Scope, Further Notes, Open questions: none (refine).
- spec.md `## Plan`: seams S1 core decide, S2 core brief, S3 cli harness, S4 GitPort contract, S5 e2e base-sync transcript; coverage row per user story; two prefactors; decisions D1–D14; risks. Checked against this base (7d956944, unchanged since the plan): still holds.
- `slices/01`–`14` written (depends_on reordered at the approve-slices rework; content and criteria unchanged); every user story is cited by some slice's acceptance; spec.md frontmatter `criteria` lists all 77 slice criteria (`01.AC1` …). `bun run test` green (1755 pass).

Slices (depends on):
1. One push path for claim release; update outcome chosen in core — prefactors (none)
2. Heads ref at every boundary; takeover resumes from it; limitations note (1)
3. One branch push per loop once the PR is open, pinned by the base-sync transcript (2)
4. Merge step after `ready` in story, quick, release (1)
5. Open-pr guard: PR head at merge is the commit CI ran on (3, 4)
6. `story edit` refused toward `update-branch`; docs (1)
7. Light-path decision: update outcomes `clean`/`resolved`, anchor, git summary, remerge-diff in the git contract (1)
8. Shipped light route with resolution review, `resolution` input, redescribe (7)
9. Carried approval over a clean merge; fresh approval after a resolution (7)
10. Resolver sees the base side (`base_side` input, norn-merge) (1)
11. Re-verify waiting stories (`base.verify`) (4, 3, 5, 6, 8, 9, 10)
12. Overlap Check item in `norn status` (3, 5, 6, 8, 9, 10)
13. Regenerate instead of resolving; spec-folder-only auto-resolve, Closes #126 (7, 3, 5, 6, 8, 9, 10)
14. Resolver asks with the merge in progress (3, 5, 6, 8, 9, 10)

Order (the person's): 01 first; then changes 1–5 (02–10); then 11–14. Critical path: 5 slices (1 → 2 → 3 → 5 → any of 11–14). Startable at once: 1 only.

## Easy to miss

- Heads ref `refs/norn/heads/<story>` is pushed at every boundary under both record policies; while the PR is open it replaces the branch push, including at claim release (handoff, watch exit). Only open-pr pushes the branch then; `story close` pushes the branch first.
- Open-pr guard (D4): a non-spec-folder change after open-pr must go back through open-pr before a gate/merge step (static validation + runtime move).
- Merge step takes `stale` only after `gate.stale.awaits_sync`, so a squash-merged PR is never read as a base move.
- `clean` for a regenerated merge needs the `Norn-Regenerated` trailer AND a remerge-diff touching only mapped paths.
- Light-path anchor = head at the latest `approve` outcome in the round, any step; agent done receipts gain `head_sha`.
- Verify red reuses the `stale` edge and `stale_loop`; no new outcome. The cache is the check receipt's `verify: {head, base}`.
- Regenerate runs inside act's update, default timeout 2m per entry; docs say commands must be fast and deterministic.
- The shipped test command is written once with a YAML anchor; pinned with a `parseWorkflowText` test.

## Not proven yet

- Nothing built. The person reviews the slices at the gate.

## Notes

- Order follows the person's ruling at approve-slices: every slice depends on 01 (prefactorings first); re-verify, overlap, regenerate and ask-instead-of-abort (11–14) also depend on the last slices of changes 1–5 (03, 05, 06, 08, 09, 10).
- Slices 07 and 10 both need "commits touching a path in a range" from git; 07 and 13 both touch act's update; 01, 03, 14 all touch claim release. These are merge conflicts, not dependencies; whichever lands second reuses the other's code.
- release.yaml gets the merge step (slice 04). Shipped workflows change in both copies; norn-merge in its bundled copy only.
- Friction: the worktree had no `node_modules`; `bun install` was needed before `bun run test`.

## Resume

Person reviews slices 01–14 at the slice gate; then slices start in dependency order.
