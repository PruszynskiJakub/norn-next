# QA gh-342 — shared workflow steps (`use:` / `like:`)

Head: cee73aaa7. Interfaces: the store's `loadWorkflows` (library entry), the dev cli (`bun packages/cli/src/main.ts init|doctor`) in throwaway repos under $TMPDIR, `bun run schema:emit`, `bun run golden -- --update`, and, for story create/edit/round start/lost-record checkout (which need a remote), the cli integration harness (runCli in-process with a fake remote): harness-tests.txt / harness.xml, 23 pass, 0 fail.

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| 01.AC1 bundled quick/story load through the store and keep the base's workflowHash (29/8, 42/10) | pass | workflow-hashes.md | base hashes equal the tests' PINNED_HASHES |
| 01.AC2 repo quick/story/release load through the store and keep the base's workflowHash | pass | workflow-hashes.md | |
| 02.AC1 name ≠ file name is broken with "must equal the file name" | pass | 02.AC1.md | |
| 02.AC2 lost-record checkout refuses workflow_invalid on bad name/invalid; pins with the listing's fingerprint | pass | harness-tests.txt | harness only (needs a remote) |
| 03.AC1 use step replaced by the shared steps under their own names | pass | loader-run.md | |
| 03.AC2 routes/start/base.step via use step enter at start; direct names work; reset_on/base.verify on use step refused | pass | loader-run.md | |
| 03.AC3 exits map to use-step routes with counter, keep means/verdict; unrouted exit → $stuck | pass | loader-run.md | `odd` → $stuck |
| 03.AC4 $done/$stuck/declared counter kept; route outside the file refused | pass | loader-run.md | |
| 03.AC5 included steps carry no limits; workflow defaults cover them | pass | loader-run.md | |
| 03.AC6 missing shared file names shared/nope.yaml and the folder | pass | loader-run.md | |
| 03.AC7 clashes (workflow step, use step, other shared, used twice) refused naming both places | pass | loader-run.md | |
| 03.AC8 unknown exit, nested use, workflow keys in shared file refused with the wording | pass | loader-run.md | all five keys |
| 03.AC9 shared files not listed; no-use source byte for byte; use source flattened, hash = sha256 | pass | loader-run.md, 07-doctor.md | |
| 03.AC10 workflow-source and workflow-shared emitted, strict workflow unchanged | pass | 03.AC10-04.AC4-schemas.md | |
| 04.AC1 like copies shallowly, target key order then new keys | pass | loader-run.md | |
| 04.AC2 like inside a shared file resolved before inclusion | pass | loader-run.md | |
| 04.AC3 each bad like refused naming file and step | pass | loader-run.md | 7 cases |
| 04.AC4 like-only workflow flattened; emitted schemas accept like | pass | loader-run.md, 03.AC10-04.AC4-schemas.md | |
| 05.AC1 bundled rewrite keeps hashes; CI wait in one file; anchors gone for like | pass | workflow-hashes.md | |
| 05.AC2 no golden case or transcript changes | pass | 05.AC2.md | 0 of 139 decide differently |
| 05.AC3 init copies shared/ (created/kept), workflows load | pass | 05.AC3-AC4-init.md | |
| 05.AC4 init writes the detected test command into the shared test check | pass | 05.AC3-AC4-init.md | |
| 06.AC1 repo rewrite keeps quick/story/release hashes | pass | workflow-hashes.md | |
| 06.AC2 `gh run watch` in exactly one file (shared/ci.yaml); others load | pass | workflow-hashes.md | |
| 07.AC1 doctor issue names shared/<name>.yaml and the step | pass | 07-doctor.md | |
| 07.AC2 missing shared file broken in doctor/listing; refused by story create/edit | pass | 07-doctor.md, harness-tests.txt | create/edit via harness |
| 07.AC3 story edit --workflow <shared file> refused as unknown | pass | harness-tests.txt | harness only; doctor never lists a shared file (07-doctor.md) |
| 07.AC4 round pins flattened text; shared edit after edit refuses start; running round keeps pin | pass | harness-tests.txt | harness only |
| 07.AC5 lost-record restart flattens the branch's shared file; missing → workflow_invalid | pass | harness-tests.txt | harness only |
| 08.AC1 recipes: following the section loads; refusals listed; named exit kept apart from a check's exits | pass | 08.AC1.md, docs/recipes.md | |
