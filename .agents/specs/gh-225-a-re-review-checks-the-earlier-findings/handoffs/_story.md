## Goal

A re-review checks the previous review's findings first (fixed or not), and only blocking and major findings are rework; minor and nit ones stay notes.

## Proof

The spec has no frontmatter `criteria`; rows are its Wanted items.

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| Review steps declare last_findings | quick and slice review steps declare `last_findings`, both copies | test | `packages/cli/assets/workflows/{quick,slice}.yaml` and `.agents/workflows/{quick,slice}.yaml` diff; exercised by `packages/core/test/unit/brief.test.ts` › "a re-review that declares last_findings checks the earlier findings first" |
| A re-review checks each earlier finding first | the brief lists the earlier review's findings and says check each, fixed or not | test | brief.test.ts › "the earlier review's findings are listed to check, fixed or not, and Inputs points at them"; "a review that does not declare last_findings keeps the earlier attempt as history only"; "no earlier findings: Last findings is none" |
| Rework is blocking and major only | implement's brief fixes blocking and major, leaves minor and nit as notes | test | brief.test.ts › "implement's Rework sorts the findings: blocking and major to fix, minor and nit left as notes"; snapshot "rework after review findings lists them" |
| norn-review skill source | first step checks the earlier findings; Decide says minor and nit are notes | agent | review read of `packages/cli/assets/skills/norn-review/SKILL.md` steps 1 and 6; `packages/cli/test/unit/assets.test.ts` keeps it free of norn words |
| Suite green | `bun run test` and `bun run typecheck` | test | review#2 on the merged HEAD: 1291 pass, tsc clean |

## Easy to miss

- The bundled skill must not name norn, steps, briefs or receipts (`packages/cli/test/unit/assets.test.ts`), so the skill says "a re-review is given the previous review's findings".
- `history.earlier.findings` is set only when the step declares `last_findings` and that earlier report had findings. Without it the key is absent, so existing `toEqual` assertions still hold.
- The `.agents/skills/norn-review` copy is not edited; the release step syncs it.

## Not proven yet

- `story.yaml` has no review step yet. Its review step comes with #227, which should declare `last_findings` too.

## Notes

- Earlier findings live on `BriefJson.history.earlier.findings`, not in a new top-level field. The earlier attempt's report is already found there, and Rework (when present) still takes precedence.
- No schema or golden change: BriefJson is not a persisted format.
- CI never started for ci#1 because PR #287 conflicted with main (GitHub runs no `pull_request` workflow on a conflicting PR). implement#3 merged main. The one conflict was in the norn-review skill: main renamed the handoff section "Done means" to "Proof" in step 7. Both sides were kept: the renumbered steps and the minor/nit line come from this branch, "Proof" from main. Main also drops `last_check`/`last_findings` from the markdown Inputs list; the JSON ref still says "see Earlier findings", and both of our new brief snapshots were re-recorded against main's brief text.

- review#2 approved the merged HEAD with no findings. The one earlier finding (minor: the skill says "blocking (or major)" but its findings format lists only blocking | minor | nit) is still not fixed and stays a note for the person.

## Resume

Review approved on the merged HEAD. Next is describe, then CI on PR #287.
