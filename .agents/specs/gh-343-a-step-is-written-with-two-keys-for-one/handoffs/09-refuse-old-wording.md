# Handoff — gh-343/09 refuse old wording

## Goal
A workflow file in the main checkout (`.agents/workflows/`, shared files included) written in the old or a mixed wording is refused (`old_wording`, `norn upgrade` named) and treated as an invalid workflow. Copies (pins, past rounds, branch file at a lost-record restart) keep loading through the translator. New units pin the new wording.

## Proof
- Refusal at the read (S1): `packages/store/test/unit/old-wording-refusal.test.ts` (old file → one `old_wording` error naming steps, keys and `norn upgrade`; mixed step refused as old; each old key alone, and `means` inside an exit route; a shared file in the old wording refuses the workflow that uses it, naming the shared file; the listing has one error per old file; a copy of the same text still loads, text kept). All went red before the change (6 of 7; the 7th was a copy-read regression guard).
- Old wording at the cli (S7, integration tier, runs in CI): `packages/cli/test/integration/old-wording.test.ts` — doctor gives one issue per old file with code `old_wording` naming `norn upgrade` (old wording refused, mixed refused, one doctor issue per file); story create and story edit `--workflow` refuse it with `norn upgrade` in `do_instead`, story edit as `invalid_workflow`; a tick starts nothing (`start.workflow_invalid`) and the inbox names it (old file treated as an invalid workflow); a story running on an old-wording pin finishes its round, pin text and `workflow_hash` unchanged, `recordErrors` empty (in-flight pin keeps loading); a new unit from a workflow using a shared file pins flattened text that a checkout read accepts (new units pin the new wording).
- Lost-record restart from an old branch file: `takeover-record-lost.test.ts` › "an old-wording workflow file on the branch loads as a copy and is pinned verbatim, its hash the branch file's".
- Past rounds and traces stay copy reads: slice 01's `workflow-reads.test.ts` (trace reader, `recordErrors`, pin read are all `copy`).
- Doctor → upgrade → doctor in a throwaway repo (the user's path end to end): evidence `1-doctor.txt` (two FAILs, `old_wording` messages naming `norn upgrade`, one of them via a shared file), `2-upgrade.txt` (two files rewritten, exit 0), `3-doctor.txt` (every check passes).
- `bun run test` 2058 pass, 0 fail; `bun run typecheck` green.

Traceability (review #1):

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | any old key, or `means`/`verdict` in an edge or exit route, is refused as old wording naming steps and keys; a refusing command's `do_instead` names `norn upgrade` | test | `packages/store/test/unit/old-wording-refusal.test.ts` › "a file in the old wording is one old_wording error…", "each of every old key is enough on its own, and a means inside an exit route too"; `packages/cli/test/integration/old-wording.test.ts` › "story create --workflow refuses an old file…", "story edit --workflow refuses an old or mixed file…" |
| AC2 | a step mixing both wordings is refused as old, same `do_instead` | test | `old-wording-refusal.test.ts` › "a step mixing both wordings is refused as old"; `old-wording.test.ts` › "story edit --workflow refuses an old or mixed file…" |
| AC3 | doctor reports one issue per old file, each naming `norn upgrade` | test | `old-wording.test.ts` › "doctor reports one issue per old file…"; `old-wording-refusal.test.ts` › "the listing reports one error per old file…" |
| AC4 | no round starts from an old file (story edit, sync/tick) and sync and the inbox report it | test | `old-wording.test.ts` › "story edit --workflow refuses…; no round starts", "a tick starts no story on an old file and the inbox names it with norn upgrade" |
| AC5 | an in-flight story on an old-wording pin finishes its round, pin text and hash untouched; past round's trace and record load | test | `old-wording.test.ts` › "the pin loads, its text and hash stay as they were…"; trace/record reads are copy reads: slice 01 `workflow-reads.test.ts` |
| AC6 | lost-record restart from an old branch file loads it and pins it verbatim, hash matching | test | `packages/cli/test/integration/takeover-record-lost.test.ts` › "an old-wording workflow file on the branch loads as a copy and is pinned verbatim…" |
| AC7 | a new unit pins the new wording, flattened when it uses `use`/`like` | test | `old-wording.test.ts` › "a workflow using a shared file is pinned flattened, in the new wording" |
| AC8 | doctor → `norn upgrade` → doctor in a throwaway repo ends with no workflow issue | agent | QA (agent); implement's evidence `1-doctor.txt`, `2-upgrade.txt`, `3-doctor.txt` |

## Easy to miss
- `parseWorkflowText(…, "checkout")` refuses old wording itself; `loadWorkflowText` checks the file and each shared file before flattening, so a shared file's old step is reported against the workflow that uses it, by the shared file's name.
- `pinWorkflow` parses as a `copy`: it only ever receives a text a checkout read already accepted, or a branch/pin text that must load as written.
- The detector is `oldWordingSteps` in `packages/store/src/wording.ts`, sharing `oldKeys` with the translator's `isOldStep`, so the refusal and `norn upgrade` agree on what is old.

## Not proven yet
- The integration tests (`old-wording.test.ts`, the new case in `takeover-record-lost.test.ts`, the adjusted `upgrade-wording.test.ts`) were written but not run locally (CI only, per the brief). Brittle points to check if CI fails: the inbox item's title containing `norn upgrade` (it comes from decide's `workflow 'oldy' is invalid: …` problem line) and the in-flight test's hand-replaced pin plus `writeState` with its hash.

## Notes
- Contract tests changed on purpose: `new-wording.test.ts` now loads the old shipped fixtures as copies (via `loadWorkflowText(…, "copy")`) and asserts that the main checkout refuses `OLD`; `upgrade-wording.test.ts` reads its "before" workflows as copies, since `loadWorkflows` now refuses them.
- `story create --workflow <old file>` keeps code `unknown_workflow` (as for any invalid workflow) but names `norn upgrade` in `do_instead` (D5: every command refusing an invalid workflow names it).
- A mixed-wording step read as a copy does not translate to the same workflow (e.g. `agent:` orientation plus `skill:` and an edge `means`): the translator treats a step with no `type` as non-agent. That is the translator's own behaviour (slice 03), outside this slice; noted, not changed.
- Seen in passing, not changed: `norn upgrade`'s suggested commit message reads "Refresh norn's skills" when only workflows were rewritten (slice 08's report), and `agentsInUse` in upgrade reads `loadWorkflows` before the rewrite, so an agent named only in an old file is not relinked on that run.
- Friction: the worktree had no `node_modules`; `bun install` first.

## Resume
Done: report `norn done done`. If CI's integration tier fails, start from the test named under Not proven yet.
