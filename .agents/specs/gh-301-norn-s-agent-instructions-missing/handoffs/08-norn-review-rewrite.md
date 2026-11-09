## Goal

Development › Skills states when a bundled skill is exact and when it gives principles; `norn-review` is rewritten to it (contracts kept, no fixed subagent prompts or word caps, command-running subagents get their rules with reasons); a before/after run on two past diffs shows the rewrite loses nothing.

## Proof

Review #1: approve, no blocking findings (one minor, AC3 wording, for the person). `bun run test` 1562 pass, `bun run typecheck` green. After merging the story branch in (its norn-retro tests sat next to this slice's norn-review tests in `packages/cli/test/unit/assets.test.ts`; both kept): 1624 pass, typecheck green.

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | Development › Skills says when a skill is exact (code reads the output, tuned to the agent tool) and otherwise gives failure prevented, outcome, principles with reasons, numbered steps only where order matters | test | `test/repo/docs.test.ts` › "Development › Skills › says when a bundled skill is exact and when it gives principles" |
| AC2 | rewritten `norn-review` keeps two axes, traceability table, findings JSON with blocking flag, verification of blocking candidates, `REVIEW.md` precedence; no word-for-word subagent prompts or word caps | test | `packages/cli/test/unit/assets.test.ts` › "norn-review keeps its contracts and gives its axes principles, not fixed prompts or word caps", with "norn-review traces every user story and criterion to a test…" and "norn-review reads REVIEW.md, verifies each blocking candidate…" |
| AC3 | command-running subagents get no push, no branch/worktree switch, no delivery-tool (norn) command, no run-state writes, each with its reason | test | `packages/cli/test/unit/assets.test.ts` › "norn-review gives a subagent that runs commands the rules its work can break, each with its reason" |
| AC4 | old and new `norn-review` on two past diffs: new raises the held defect on the first, no blocking finding on the second; outputs in evidence | agent | QA (agent): implement's evidence `gh249-*`, `gh273-*`, `comparison.md` |

## Easy to miss

- `norn-review` is a craft skill: the "unaware of norn" lint forbids the word norn and the words step/workflow/receipt/outcome/brief in its prose. The rule AC3 calls "no norn command" is therefore worded "No command of the delivery tool that started the review" (as `norn-retro` already says "the delivery tool"). The person should confirm that wording meets the criterion.
- The findings JSON block and field list stay exact (code reads them); everything else became principles with reasons.

## Not proven yet

- AC4 (the rewrite loses nothing on past diffs) as worded is **not met, by either version**: re-run blind, the old and the new skill both missed gh-249's original blocking defect (GitLab draft MRs lose draft status on retitle) and both raised a blocking finding on gh-273, which originally passed clean (a `#` line inside a fenced code block in Progress ends the section, shown by a probe). Against the old skill the new one loses nothing: every blocking finding it raised, the old one raised too; the old one's two extra blocking findings are an untested Wanted item (gh-249) and issue numbers in comments (gh-273, which does not hold at that head). Full table: evidence `comparison.md`. Jakub judges at the PR (D17); a person may want a third diff or a second sample.

## Notes

- Comparison cases, from delivery records `refs/norn/runs/gh-249` and `gh-273`: gh-249 review #1 at head `eb979aa` over base `7fd61b2` raised the blocking "GitLab draft MRs are retitled at the first sync, which removes their draft status", fixed in rework; gh-273 review at head `4b9567c` over base `6db7dbd` approved with one minor finding. Each skill version reviewed a `git archive` copy of the head under `$TMPDIR`, blind to the record.
- `.agents/skills/norn-review/` is the installed copy; left untouched as the rules say (the next `norn init`/upgrade rewrites it).

## Resume

QA this slice: give AC4 its verdict from `comparison.md` (as worded neither version meets it; the new one loses nothing against the old), and have the person confirm the AC3 "delivery tool" wording.
