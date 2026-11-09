## Goal

Development › Skills states when a bundled skill is exact and when it gives principles; `norn-review` is rewritten to it (contracts kept, no fixed subagent prompts or word caps, command-running subagents get their rules with reasons); a before/after run on two past diffs shows the rewrite loses nothing.

## Proof

- Exact-versus-principled rule in Development › Skills (AC1): `test/repo/docs.test.ts` › "Development › Skills › says when a bundled skill is exact and when it gives principles" (red first); docs lint green in `bun run test`.
- `norn-review` keeps the two axes, table, findings JSON with blocking flag, checks of blocking findings and `REVIEW.md` precedence, and holds no quoted subagent prompt or word cap (AC2): `packages/cli/test/unit/assets.test.ts` › "norn-review keeps its contracts and gives its axes principles, not fixed prompts or word caps" (red first), plus the existing pins "norn-review traces every user story…" and "norn-review reads REVIEW.md, verifies each blocking candidate…", unchanged and green.
- Command-running subagents get no push, no branch or worktree switch, no delivery-tool command, no writes under run state, each with its reason (AC3): `packages/cli/test/unit/assets.test.ts` › "norn-review gives a subagent that runs commands the rules its work can break, each with its reason" (red first).
- Before/after on past diffs (AC4, verifier agent): old and new outputs in the step's evidence (`gh249-*`, `gh273-*`, `comparison.md`).
- `bun run test` 1562 pass, `bun run typecheck` green.

## Easy to miss

- `norn-review` is a craft skill: the "unaware of norn" lint forbids the word norn and the words step/workflow/receipt/outcome/brief in its prose. The rule AC3 calls "no norn command" is therefore worded "No command of the delivery tool that started the review" (as `norn-retro` already says "the delivery tool"). The person should confirm that wording meets the criterion.
- The findings JSON block and field list stay exact (code reads them); everything else became principles with reasons.

## Not proven yet

- AC4 is judged by Jakub at the PR from the evidence (D17).

## Notes

- Comparison cases, from delivery records `refs/norn/runs/gh-249` and `gh-273`: gh-249 review #1 at head `eb979aa` over base `7fd61b2` raised the blocking "GitLab draft MRs are retitled at the first sync, which removes their draft status", fixed in rework; gh-273 review at head `4b9567c` over base `6db7dbd` approved with one minor finding. Each skill version reviewed a `git archive` copy of the head under `$TMPDIR`, blind to the record.
- `.agents/skills/norn-review/` is the installed copy; left untouched as the rules say (the next `norn init`/upgrade rewrites it).

## Resume

Review this slice.
