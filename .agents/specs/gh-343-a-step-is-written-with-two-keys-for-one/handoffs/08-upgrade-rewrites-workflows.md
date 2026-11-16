### Goal

`norn upgrade` rewrites every old-wording file in the main checkout's `.agents/workflows/` and `shared/` to the new wording, staged with the rest of the upgrade; a file the rewrite refuses is listed with its line, the rest still move, exit 0.

### Proof

Review #1 (approve) traceability; all tests in `packages/cli/test/integration/upgrade-wording.test.ts` (integration tier, CI). The reviewer ran the three upgrade integration files locally: 23 pass. test#1 (`bun run test` + `bun run typecheck`) passed.

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | old workflow/shared files rewritten, load to the same workflow, staged, listed under `workflows.rewritten` in `--json` and markdown | test | `upgrade-wording.test.ts` › "each old file is rewritten to the new wording…", "the markdown report names the rewritten files" |
| AC2 | a file with an unplaceable comment left as written, listed under `workflows.refused` (file, line, message); others rewritten; `norn_version` written; exit 0 | test | `upgrade-wording.test.ts` › "that file is left as written and listed…", "the markdown report names the refused file with its line" |
| AC3 | a second upgrade changes no workflow file | test | `upgrade-wording.test.ts` › "a second run changes no workflow file and reports none rewritten" |
| AC4 | an all-new-wording repo: none rewritten, no workflow change reported | test | `upgrade-wording.test.ts` › "a repo whose files are all in the new wording…" |
| AC5 | run state in the machine dir hashes the same before and after | test | `upgrade-wording.test.ts` › "units with pins, receipts and state…" |
| Story 34 | one command and one commit move workflow and shared files over | test | AC1 tests (staged alongside skills and `norn_version`) |
| Story 38 (S6 part) | an unplaceable comment refuses that file only; the others are still rewritten | test | AC2 tests |

### Easy to miss

- The rewrite runs after every refusal check and the tick lock, before `norn_version` (D9); a refused file never makes the run fail.
- Init still ships the old wording until the shipped-files slice: the upgrade tests' setup moves init's files to the new wording first (`rewriteWorkflowWording` in `setUpAt` / `repoAt030`), so they hold whichever wording init ships. `upgrade-version.test.ts` setup does the same, else its "nothing to upgrade" cases would see the shipped files rewritten.

### Not proven yet

- Integration tier as a whole runs in CI only.

### Notes

- Seam: store `rewriteWorkflowWording(root)` (`packages/store/src/upgrade-wording.ts`) → `{ rewritten, refused }`, paths relative to root; lists top-level files then `shared/`, each written atomically only when `translateWording` changed it. Report gains `workflows: { rewritten, refused }`; the commit message wording is unchanged.
- `docs/recipes.md` roll-out step 3 now says what upgrade does to workflow files; the reference test's summary line updated with the command summary.

### Resume

Done; next is review of commit `cli: norn upgrade rewrites old-wording workflow and shared files`.
