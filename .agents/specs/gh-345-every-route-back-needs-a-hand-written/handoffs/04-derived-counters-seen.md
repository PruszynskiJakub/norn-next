## Goal

A derived counter (`review.changes_requested`, `integrate.conflict`) shows under its name wherever counters show today: the exhausted park and Unblock item, the brief's last-round warning, status, story view, story list, and `norn run rerun --reset`. Units pinned before the change keep their old names. D10 holds: no source change was needed, only tests.

## Proof

- AC1 exhausted park and Unblock item name `review.changes_requested` with its edge and target: `packages/core/test/unit/derived-counters.test.ts` › "a fourth send-back parks exhausted naming `review.changes_requested`…"
- AC2 last-round warning: same file › "with the counter at 2 of 3, the brief for the implement step its next send-back starts warns…" (see Notes: warns `(3/3)`)
- AC3 status, story view and the status line: `packages/cli/test/integration/derived-counters-run.test.ts` › "norn story list on the holder shows `[review.changes_requested 1/3]`…", "on a machine that does not hold it, norn status lists…" (the line equals the named-counter line except for the name), "…norn story view lists `review.changes_requested 1/3`"
- AC4 `rerun --reset review.changes_requested`: same cli file › "exhausted, it is refused an unknown --reset with the counters it has, and `--reset review.changes_requested` sets it back to 0 and reruns the step"
- AC5 unknown name refused, `do_instead` lists `<review.changes_requested>`: the same test
- AC6 a unit pinned with `ready_loop` before its workflow file dropped it keeps `ready_loop`, and `--reset ready_loop` works (`--reset review.changes_requested` is refused there): cli file › "keeps `ready_loop`, and `norn run rerun --reset ready_loop` works"
- AC7 the `integrate.conflict` bound (max 2, resets on `integrate.done`) matches `conflict_loop`: core file › "two conflicts go to merge, the third parks exhausted…" and "integrate.done after a conflict ends the run at $done…"
- `bun run test` (2106 pass) and `bun run typecheck` green. I also ran the new cli integration file once by itself (5 pass): `bun test --config=bunfig.integration.toml --timeout=20000 packages/cli/test/integration/derived-counters-run.test.ts`.

## Easy to miss

- Today `norn status` and `norn story view` list counters only for a story held on **another** machine (read from the record ref; docs/concepts.md). For a story held here, the line with counters is `norn story list`. So the AC3 test reads status and story view from a second clone (with record policy `remote`), the way `non-holder-views.test.ts` does, and reads `story list` on the holder.
- The core tests feed a pinned workflow that already holds the derived counters (seam S2). The cli test writes YAML with no counters, so the loader derives them (seam S4).

## Not proven yet

- The watch is not driven by its own test. It shares the view's counter formatting (`packages/view/src/format.ts`), which the story list and status tests cover.

## Notes

- AC2 and user story 22 give `(2/3)` as the example, but the brief warns only once a counter **is at** its max: at 3/3 one more send-back exhausts, while at 2/3 a send-back only reaches 3/3. Changing that would change the bound's meaning for every counter and break D10. So the test starts with the counter at 2 of 3, has review send the work back, and checks that the next implement brief warns `Last round on review.changes_requested (3/3)`. Review should confirm this reading, or the spec example should change.
- The cli test pins gh-6 on `old.yaml` (explicit `ready_loop`), then rewrites `old.yaml` to derive, commits, and switches the default workflow to `flow`. gh-5 needs `tick --sync` before the new issue is seen.
- The core and cli tests passed against unchanged code, as D10 predicts, so no test went red first: they pin behaviour, not new code.

## Resume

Nothing left in this slice. Next step: review against the slice's acceptance criteria.
