## Goal

A derived counter (`review.changes_requested`, `integrate.conflict`) shows under its name wherever counters show today: the exhausted park and Unblock item, the brief's last-round warning, status, story view, story list, and `norn run rerun --reset`. Units pinned before the change keep their old names. D10 holds: no source change was needed, only tests.

## Proof

Core file: `packages/core/test/unit/derived-counters.test.ts`. CLI file: `packages/cli/test/integration/derived-counters-run.test.ts`.

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 (story 21) | a fourth send-back parks exhausted naming `review.changes_requested` with its edge and target; the Unblock item names it the same way | test | core › "a fourth send-back parks exhausted naming `review.changes_requested`…" |
| AC2 (story 22) | the brief's last-round warning names the derived counter | test | core › "with the counter at 2 of 3, the brief for the implement step its next send-back starts warns…" (warns `(3/3)`, see Notes) |
| AC3 (story 23) | status and story view list `review.changes_requested 1/3`; the status line stays about as long as with a named counter | test | cli › "norn story list on the holder shows…", "on a machine that does not hold it, norn status lists…", "…norn story view lists `review.changes_requested 1/3`" |
| AC4 (story 24) | `rerun --reset review.changes_requested` sets it back to 0 and reruns the step | test | cli › "exhausted, it is refused an unknown --reset … and `--reset review.changes_requested` sets it back to 0 and reruns the step" |
| AC5 (story 25) | an unknown `--reset` name is refused, listing the unit's counters | test | the same cli test (`do_instead` lists `<review.changes_requested>`) |
| AC6 (story 31) | a unit pinned with `ready_loop` keeps it, and `--reset ready_loop` works | test | cli › "keeps `ready_loop`, and `norn run rerun --reset ready_loop` works" |
| AC7 (story 28's exception) | `integrate.conflict` (max 2, resets on `integrate.done`) bounds the same as `conflict_loop` | test | core › "two conflicts go to merge, the third parks exhausted…" and "integrate.done after a conflict ends the run at $done…" |

Review#1 ran both files: core 4 pass, cli integration 5 pass. The check `bun run test && bun run typecheck` passed.

## Easy to miss

- `norn status` and `norn story view` list counters only for a story held on **another** machine (read from the record ref). For a story held here, `norn story list` is the line that shows counters. So the AC3 test reads status and story view from a second clone (record policy `remote`).
- The core tests feed a pinned workflow that already holds the derived counters (seam S2). The cli test writes YAML with no counters, so the loader derives them (seam S4).

## Not proven yet

- The watch has no test of its own. It uses the same counter formatting as the view (`packages/view/src/format.ts`), and the story list and status tests cover that formatting, as the Plan's coverage table allows.

## Notes

- Review finding F1 (minor, not rework): AC2 and user story 22 give `(2/3)` as the warning example, but the brief warns once a counter is at its max (`packages/core/src/brief.ts:304`). The implement brief after a send-back from 2/3 therefore shows `(3/3)`, the last round. The test pins `(3/3)`. Changing the warning would change it for every counter and break D10, so the spec example is the thing to fix, not the code.
- The cli test pins gh-6 on `old.yaml` (explicit `ready_loop`), then rewrites `old.yaml` to derive, commits, and switches the default workflow to `flow`. gh-5 needs `tick --sync` before the new issue is seen.
- The tests passed against unchanged code, as D10 predicts. They pin existing behaviour; no new code was needed.

## Resume

Review approved. Next is this slice's integrate into the story branch. Nothing is left to do in this unit.
