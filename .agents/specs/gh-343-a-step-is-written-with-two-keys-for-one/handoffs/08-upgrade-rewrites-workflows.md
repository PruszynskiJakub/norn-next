### Goal

`norn upgrade` rewrites every old-wording file in the main checkout's `.agents/workflows/` and `shared/` to the new wording, staged with the rest of the upgrade; a file the rewrite refuses is listed with its line, the rest still move, exit 0.

### Proof

All in `packages/cli/test/integration/upgrade-wording.test.ts` (integration tier, CI; run locally once as a single file: 7 pass, and 6 of 7 red with the rewrite call disabled — the rerun case passes either way, as it should):
- AC1 old files rewritten, same loaded workflow, staged, listed under `workflows.rewritten` (`--json` and markdown) → "each old file is rewritten…", "the markdown report names the rewritten files".
- AC2 one unplaceable comment: that file untouched, listed under `workflows.refused` with file, line, message; others rewritten; `norn_version` written; exit 0 → "that file is left as written…", "the markdown report names the refused file with its line".
- AC3 second run changes no workflow file → "a second run changes no workflow file…".
- AC4 all-new repo: none rewritten, no workflow line → "a repo whose files are all in the new wording…".
- AC5 run state under the norn home's `runs/` hashes the same → "units with pins, receipts and state…".
- `bun run test` (2033 pass) and `bun run typecheck` green; `bun run docs:emit` run (reference summary line).

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
