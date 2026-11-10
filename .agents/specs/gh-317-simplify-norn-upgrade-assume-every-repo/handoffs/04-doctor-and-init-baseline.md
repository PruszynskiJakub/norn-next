# Handoff — gh-317/04 doctor's version check and init apply the 0.30 baseline

### Goal
`norn doctor` fails its version check on a repo with no or a pre-0.30 `norn_version` using the guard's words; `norn init` refuses such a team file before any write; a new repo and a 0.30+ repo behave as before.

### Proof
- AC1 (doctor's version check fails with the guard's code, error and do_instead, markdown and `--json`): `packages/cli/test/integration/version-baseline.test.ts` › "doctor's version check fails with version_missing / version_too_old and the rule's error and do_instead, as JSON and as markdown" (both `doctor` and `doctor --repo`); also `housekeeping.test.ts` › "no version recorded fails the version line with the version guard's code and words". Red first, green after.
- AC2 (no team file → init creates it recording the running norn): `init-version.test.ts` › "AC1 B1: a repo with no norn_version gets the binary's…" (kept, moved to 0.30.0).
- AC3 (team file with no or 0.29.4 version → exit 3, the code, the 0.30 path, no file changes): `version-baseline.test.ts` › "init exits 3 with version_missing / version_too_old and the 0.30 path, and changes no file" (red first); `init-version.test.ts` › "a team file with no norn_version is refused before any write, and stays as it was".
- AC4 (0.30+ team file: version never moved, differing skill kept, names `norn upgrade`): `init-version.test.ts` › "AC2 B28" and "AC3 B28" (kept, versions moved from 0.19 to 0.30.x).
- `bun run test` (1736 pass) and `bun run typecheck` green. Integration files run locally and green: version-baseline, init-version, init-review, version-guard, version-status, layout-guard, upgrade-version, housekeeping, config-runtime, harness-config, upgrade-records, help-tree, machine-dir, story-create, archive-ref, labels, record-ref.

### Easy to miss
- init's refusal sits right after `void ctx.config` and before every write (config template, user config, REVIEW.md, schemas). It only applies when the team file exists. With no team file, init still records the version (story 15).
- doctor's `VersionCheck` lost `warning` and gained `code`. Nothing else read `warning`.
- The words come only from `versionBaseline` in `@norn/core` (D1). doctor and init word nothing themselves.

### Not proven yet
- The full integration and e2e tiers were not run (CI runs them).
- `packages/cli/test/integration/mailbox-across-machines.test.ts` fails 14 tests locally. Its `beforeAll` writes a team file with no `norn_version` after `init` (`teamConfig(...)`), so slice 02's tick guard refuses (`version_missing`). This is not caused by this slice: tick is untouched here. It needs `h.recordVersion()` after writing the team file (and in `setPolicy`). Left out as outside this slice's scope.

### Notes
- Tests that wrote a versionless team file and then ran init or doctor were moved onto a recorded version: `config-runtime.test.ts` (`h.recordVersion()` before init), and `housekeeping.test.ts` (the wrong-type config test restores the version; the doctor version tests use 0.30.x/0.31.x; old B5 "no version is a warning" now asserts the failure).
- Docs: `docs/recipes.md`, `docs/reference.md` and `docs/concepts.md` now describe init's refusal and doctor's failure. `bun run docs:emit` produced no further diff.
- Friction: the worktree had no `node_modules`, so `bun install` had to run before any test could start.

### Resume
Done: committed as `feat: doctor and init apply the 0.30 norn_version baseline`. Next is the review of this slice. Someone needs to decide whether the `mailbox-across-machines` setup fix goes into slice 02's rework or into this story's later slices.
