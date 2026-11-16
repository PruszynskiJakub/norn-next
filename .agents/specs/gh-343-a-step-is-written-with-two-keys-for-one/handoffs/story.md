# gh-343 handoff

## Goal

A workflow step opens with one head key (`agent:`, `check:`, `gate:`, a value-less verb, `use:`); agent skills become an optional `skills:` list; meanings and verdicts move to sibling `means:` / `verdict:` maps; `by:` picks the agent; `norn upgrade` rewrites old-wording files losslessly while old pins keep loading. All 10 slices are integrated; QA #1 is done; pr.md (the PR body) is written.

## Proof

- QA #1 criteria report (this run's evidence, `report.md`): 47 pass, 1 person, 5 unverified, 0 fail.
- Golden decisions: all 139 cases re-decided by the current decide are identical, and every case's `decisions` is byte-identical to origin/main, matched by source and tick (the cases are renamed because their embedded workflows changed).
- Translator (slice 03): the 9 shipped files and release.yaml at origin/main translate byte for byte to the expected files, and a second translation changes nothing. Folded, block and quoted scalars are kept; an orphaned comment refuses the file with its line.
- Loader (slice 04), checked by script and with the dev CLI `doctor` in throwaway repos: head keys, verbs, `like`, orientation, `skills`, `by:`, means and verdict refusals, shared `exit` routes, and old-wording copies load equal to the new wording.
- Upgrade and refusal (slices 08 and 09), checked with the dev CLI in throwaway repos:
  - `upgrade` rewrites and stages the old files, lists refused files, exits 0, is idempotent and leaves the machine dir hash unchanged.
  - An old main-checkout file is refused (exit 3, `do_instead` names `norn upgrade`), and `doctor` reports one issue per file.
  - doctor → upgrade → doctor ends clean.
- Brief: 1, 2, 3 and 0 skills render as specified.

## Easy to miss

- The loaded model stays the `type`-tagged union. Only the file format changed.
- Old-wording fixtures that are *about* old wording (pins, branch files, upgrade input) stay old on purpose.
- The workflow hash moves whenever a workflow's text moves; decisions must not.

## Not proven yet

- 06.AC1 (the cli integration suite passes) and 07.AC1 (the unit and e2e tiers pass): CI run 43915279125 on PR #353 failed three integration tests (below, fixed); e2e and the other shard passed. Green CI on the new head is still to come.
- 01.AC1 (every read loads the same workflow as before): its restart and record tests are in the integration tier, so the same CI gap applies.
- 09.AC5 (a story in flight on an old-wording pin): the old pin was observed running to `$done` untouched with its record readable. A past round's trace was not replayed.
- 09.AC6 (record lost, old-wording file on the branch): only the shipped integration test was run (it passes). No restart was driven by hand.
- 05.AC4 (person): whether each agent step's orientation steers well. The table is in `05.AC4.md`. QA's view: the new orientations read well; story `qa`, refinement `plan`/`refine` and `describe` kept terse or mechanical text.

## Notes

- CI fix round 1 (three integration tests the slices had left stale; all three files pass locally, unit tier and typecheck green):
  - `init-shared.test.ts` "the detected test command is written into the shared file": expected `run: "npm ci && npm test"`; the shared file now says `check:`.
  - `old-wording.test.ts` "a tick starts no story on an old file": the remote sync is throttled (`sync_interval`) and the file's earlier test had already synced, so gh-7 was never taken in; the first tick now runs with `--sync`.
  - `upgrade-wording.test.ts` "norn upgrade never touches run state": the old-wording `solo.yaml` was refused in the main checkout, so no unit started and no pin existed; the unit now starts on solo's translated new wording, then the old text is committed before `norn upgrade`.

- Seen during QA, not failures of this story:
  - `norn status` shows a story on an invalid workflow as "taken in — the next tick starts it" without naming the problem (same as before this change).
  - An upgrade that only rewrote workflows suggests the commit message "Refresh norn's skills".
  - `story create --workflow X` with a schema-invalid new-wording X says "no workflow 'X'".
- 05.AC2 "shared copies match": the repo copies keep their own check commands and exit names and split ship into ci/land; assets.test checks the same steps and head keys, which is what QA judged.
- Evidence scripts (`brief-skills.ts`, `refine-decide.ts`, `tr.ts`, `scripts/`, `tools/`) are in the QA evidence folder.

## Resume

Wait for the `ci` check on the new head; if it fails, read the job annotations (the command is in the ci check's output) and fix the named tests.
