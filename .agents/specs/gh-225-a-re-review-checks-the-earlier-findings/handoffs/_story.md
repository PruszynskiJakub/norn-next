## Goal

A re-review checks the previous review's findings first (fixed or not), and only blocking and major findings are rework; minor and nit ones stay notes.

## Done means

- Review steps in `quick` and `slice` declare `last_findings`, in both copies (`packages/cli/assets/workflows/` and `.agents/workflows/`).
- A re-review's brief lists the earlier review's findings under "Earlier findings" and tells it to check each first: `packages/core/test/unit/brief.test.ts` › "a re-review that declares last_findings checks the earlier findings first" (three tests, one snapshot).
- implement's Rework puts blocking and major findings first to fix, and minor and nit ones under "Notes … minor and nit" with "Leave these as notes: do not fix them in this round": brief.test.ts › "implement's Rework sorts the findings…", plus the updated snapshot of "rework after review findings lists them".
- `norn-review` skill source (`packages/cli/assets/skills/norn-review/SKILL.md`) has a first step "Check the earlier findings first", and Decide says minor and nit findings are notes, never fixed in another round.
- `bun run test` (1286 pass) and `bun run typecheck` are green.

## Easy to miss

- The bundled skill must not name norn, steps, briefs or receipts (`packages/cli/test/unit/assets.test.ts`), so the skill says "a re-review is given the previous review's findings".
- `history.earlier.findings` is set only when the step declares `last_findings` and that earlier report had findings. Without it the key is absent, so existing `toEqual` assertions still hold.
- The `.agents/skills/norn-review` copy is not edited; the release step syncs it.

## Not proven yet

- `story.yaml` has no review step yet. Its review step comes with #227, which should declare `last_findings` too.

## Notes

- Earlier findings live on `BriefJson.history.earlier.findings`, not in a new top-level field. The earlier attempt's report is already found there, and Rework (when present) still takes precedence.
- No schema or golden change: BriefJson is not a persisted format.

## Resume

Nothing left in implement; the next step is update → test → review.
