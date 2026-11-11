# gh-337 — handoff

## Goal

Make a base move under a story cheap, automatic and reviewable, and make each rework loop cost one CI run: all nine changes from the issue, in this one story.

## Proof

- spec.md: Problem Statement, Solution, 76 user stories, Out of Scope, Further Notes, Open questions: none (refine).
- spec.md `## Plan`: seams S1 core decide, S2 core brief, S3 cli harness, S4 GitPort contract, S5 e2e base-sync transcript; coverage row per user story; two prefactors; decisions D1–D14; risks. Checked against this base (7d956944, unchanged since the plan): still holds.
- `slices/01`–`14` written; spec.md frontmatter `criteria` lists all 77 slice criteria. All 14 slices built and integrated; unit tier and typecheck green (test#1).
- QA #1 (head 8cc853ef): 71 of 77 criteria pass, 6 fail. The full criteria report, the evidence and findings.json are in this run's QA evidence (report.md has one line per criterion).
- Rework of QA #1 (implement #1):
  - 02.AC3 "a takeover after a crash resumes from the heads ref merged with the remote branch, never rebased": `packages/cli/src/runtime/checkout.ts` `headsVersus` + `prOpen`: with the PR open and the heads ref diverged from the PR branch (a person's push), the take merges the remote branch into the heads ref in the story worktree (`git merge --no-ff`, trailers Norn-Story/Norn-Step take/Norn-Tick); a conflicting merge (`mergeTree`) is refused before the claim with `branch_diverged`. Tests, red first: `packages/cli/test/integration/heads-ref.test.ts` › "AC3: record.policy local|remote: with the PR open, a person pushed to its branch: B's worktree merges…" and › "AC3: with the PR open, a person's push that clashes…"; "AC3: with no PR open, a branch that diverged from the heads ref was rewritten: B takes the branch as it is" pins the rewrite case. docs/limitations.md says the same.
  - 03.AC1–AC3, AC5, AC6 verifier: `packages/cli/test/integration/push-rule.test.ts` LOOP workflow made guard-compliant (ready.approve → `fin` open-pr → $done); the first test now asserts ready approving pushes nothing and the one more branch push is `fin`'s. Was 0/5 locally, now 5/5.

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

- Nothing known. QA #1's two findings are fixed (see Proof, implement #1); QA has to re-check 02.AC3 and 03.AC1–AC3, AC5, AC6.

## Notes

- Order follows the person's ruling at approve-slices: every slice depends on 01 (prefactorings first); re-verify, overlap, regenerate and ask-instead-of-abort (11–14) also depend on the last slices of changes 1–5 (03, 05, 06, 08, 09, 10).
- Slices 07 and 10 both need "commits touching a path in a range" from git; 07 and 13 both touch act's update; 01, 03, 14 all touch claim release. These are merge conflicts, not dependencies; whichever lands second reuses the other's code.
- release.yaml gets the merge step (slice 04). Shipped workflows change in both copies; norn-merge in its bundled copy only.
- QA notes for the person: 05.AC1 guards only gates that can reach merge or $done (agent → human-qa is accepted). 07.AC2: a ready reject re-reviewed with review approve sets a new light-path anchor. No GitPort fake exists, so the "and the fakes" parts of 07.AC6 and 13.AC7 were checked against the real adapter only.
- Friction (QA): `bun run golden` without `--update` harvests cases into the repo rather than checking them; the replay check is `packages/core/test/unit/golden.test.ts`. Hooks block `git push`/`git checkout` even in scratch repos under $TMPDIR.
- Friction: the worktree had no `node_modules`; `bun install` was needed before `bun run test`.
- Takeover decision (implement #1): refs alone cannot tell a person's push onto a branch the heads ref is ahead of from a person's force-push rewrite (the takeover-record.test.ts rewrite cases). The push rule decides: the heads ref moves alone only while the PR is open, so only then is a divergence merged; with no PR open it is a rewrite and the branch is taken as before (never resurrecting commits a person dropped). Under `local` policy the merged takeover still restarts at the last record push's step (open-pr), as limitations.md says.

## Resume

Run QA again on this head: re-check 02.AC3 (heads-ref.test.ts) and 03.AC1–AC3, AC5, AC6 (push-rule.test.ts) with `bun test --config=bunfig.integration.toml <file>`.
