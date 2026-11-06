## Goal

GR6 cleanup records a merged story's units done, so a story merged while parked (at `ready` or anywhere) leaves the inbox and `story wait --until done` returns (#88); then, if the person wants it in this round, a workflow merging its own PR (#72).

## Progress

- #88 done, committed. Decide's `cleanup_merged_story` (`packages/core/src/decide/story.ts`, `finishMerged`) now carries `finish`: every unit with a valid state not yet `done`, recorded `done` with `park` and `run` cleared (step kept). Act (`cleanupMerged`, `packages/cli/src/runtime/act/lifecycle.ts`) writes those states first, before the archive push, so the archived record carries them; a failed archive leaves the cleanup owed and the next tick writes the same states.
- Units that failed validation are left alone (S2).
- GR6 in `.agents/RULES.md` amended to say so.
- Tests: decide unit test (`gh-88 GR6: …` in `packages/core/test/unit/decide.test.ts`, also checks the inbox has only Recently done items afterwards); `runtime.test.ts` GR6 test now parks the unit at a gate before the merge and checks `state.json` is done after (red without the act change, checked).
- Golden: `bun run golden -- --update` rewrote 3 cases (only the new `finish` field). Transcript `test/e2e/transcripts/base-sync.txt` updated (one new state.json write at cleanup).
- Stories cleaned up by an older norn (gh-60, gh-69, gh-76) keep their parked state; not migrated.
- Not changed: `norn-fsd-round` still waits `--until merged`; it could go back to `--until done` now (triage note), left for a later change.
- #72 (a workflow merging its own PR) is a GR5 change with open decisions (merge method, refused merge, process check); asked the person whether it belongs in this quick round.

## Resume

Read the person's answer to the #72 question. If #72 is out of this round: report `norn done done`. If in: add a `merge` git action (W2/W8), after a gate, per the answer, with tests at decide and the act/remote port.
