## Goal

`norn-review` applies a generic security checklist when a diff touches paths the repo's `REVIEW.md` marks sensitive; this repo's `REVIEW.md` lists its sensitive paths.

## Proof

The spec is a quick issue with no criteria frontmatter; its two Wanted items are the rows. Both are skill and docs text, so the review read the files rather than a test.

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| Security checklist in norn-review | bundled `norn-review` gains a generic checklist (injection, secrets, process spawning, env loading, PATH shim, tokens), applied when the diff touches `REVIEW.md` sensitive paths, findings blocking | review (docs) | `packages/cli/assets/skills/norn-review/SECURITY.md`; wired in `SKILL.md` step 3 (Sensitive paths), step 4 (Standards gets SECURITY.md, prompt item (d)); whole skill folders install, as `test/e2e/slice-workflow.test.ts` › init shows for SMELLS.md |
| This repo lists its sensitive paths | `REVIEW.md` names `.github/workflows/`, `scripts/`, `packages/schema/src/`, `packages/store/`, `packages/cli/src/runtime/shim.ts` | review (docs) | `REVIEW.md` › `## Sensitive paths` (all five exist in the tree) |

`bun run test` (1282 pass, lints included) and `bun run typecheck` green, re-run at review.

## Easy to miss

- Edit only the bundled source; the `.agents/skills/norn-review` copy is refreshed by the release step.
- The glossary lint bans `task` even in prose ("the work needs").
- Findings keep the `standards` axis: no new axis value in the findings JSON.

## Not proven yet

- Whether a reviewer agent actually picks up SECURITY.md on a sensitive diff (QA by use).
- The starter `REVIEW.md` that `norn init` writes (`packages/cli/assets/REVIEW.md`) has no `## Sensitive paths` section, so other repos do not learn of it (minor review finding, left for a follow-up).

## Notes

- Checklist lives in its own file beside SMELLS.md so the skill body stays short and the list loads only when needed.
- Out of scope per issue: check step outcomes, a path config key, a separate review step.
- Base merge with main (567ecf339fd5): main added "Check the earlier findings first" as step 1 of norn-review and renamed the handoff table section to Proof; the merge kept both, so the sensitive-paths wiring now sits in steps 3 and 4.

## Resume

main (567ecf339fd5) merged in at resolve; next is the workflow's step after resolve.
