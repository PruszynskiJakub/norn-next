## Goal

`norn-review` applies a generic security checklist when a diff touches paths the repo's `REVIEW.md` marks sensitive; this repo's `REVIEW.md` lists its sensitive paths.

## Done means

- `packages/cli/assets/skills/norn-review/SECURITY.md`: the checklist (injection, secrets, process spawning, env loading, the PATH shim, tokens, plus CI workflows and persisted data), worded for any repo; breaches are bugs, so blocking.
- `packages/cli/assets/skills/norn-review/SKILL.md`: step 2 (Sensitive paths), step 3 (Standards subagent gets SECURITY.md; its prompt item (d)) wire it in.
- `REVIEW.md`: `## Sensitive paths` lists `.github/workflows/`, `scripts/`, `packages/schema/src/`, `packages/store/`, `packages/cli/src/runtime/shim.ts`.
- Docs/skill change only: no new test; `bun run test` (1282 pass, glossary and skill-command lints included) and `bun run typecheck` green.

## Easy to miss

- Edit only the bundled source; the `.agents/skills/norn-review` copy is refreshed by the release step.
- The glossary lint bans `task` even in prose ("the work needs").
- Findings keep the `standards` axis: no new axis value in the findings JSON.

## Not proven yet

- Whether a reviewer agent actually picks up SECURITY.md on a sensitive diff (QA by use).

## Notes

- Checklist lives in its own file beside SMELLS.md so the skill body stays short and the list loads only when needed.
- Out of scope per issue: check step outcomes, a path config key, a separate review step.

## Resume

Nothing left in implement; next is the workflow's review.
