## Goal
No command checks for, names or moves the pre-0.13 layout. A repo holding only `.agents/norn/` counts as a repo with no team file, so the missing-version refusal stops it. Doctor has no layout section.

## Proof
Review #1 traceability:

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | on a pre-0.13 repo an acting command exits 3 with `version_missing`, every old file where it was, unchanged | test | `packages/cli/test/integration/pre-013-repo.test.ts` › "an acting command exits 3 with version_missing, and every old file is where it was, unchanged" (tick, story start, config set; exact CliError, old files byte-equal, clean `git status`) |
| AC2 | on such a repo an agent hook does not refuse on the layout | test | same file › "an agent hook in a unit worktree does not refuse on the layout" (stop and pre-tool-use exit 0, no layout in the answer) |
| AC3 | `norn doctor` (markdown and `--json`) has no layout section or key and names no old layout or `norn migrate` | test | same file › "a pre-0.13 repo: no layout key…" and "a repo from 0.30 on: the same" (full and `--repo`) |
| US14 | doctor shows no layout section, no old layout or `norn migrate` | test | as AC3 |
| US18 | a pre-0.13 repo is read as having no team file, nothing moved | test | as AC1 |

- AC1 (acting command on a pre-0.13 repo exits 3 with `version_missing`, old files untouched): `packages/cli/test/integration/pre-013-repo.test.ts` › "an acting command exits 3 with version_missing, and every old file is where it was, unchanged". Red first: before the change, `old_layout` came back.
- AC2 (an agent hook does not refuse on the layout): same file › "an agent hook in a unit worktree does not refuse on the layout". It passed before the change too, because the hook used to return `{}` on an old layout. Now the hook just goes on as on any repo.
- AC3 (doctor has no layout section or key, nothing mentions an old layout or `norn migrate`, markdown and `--json`, full and `--repo`): same file › "a pre-0.13 repo: no layout key…" and "a repo from 0.30 on: the same". Red first: `repo.layout` was present.
- `bun run test` (1736 pass) and `bun run typecheck` are green. I also ran the upgrade, hook and doctor integration files locally: all green.

## Easy to miss
- Upgrade (slice 03) still uses the layout: `repoLayout`, `layoutRefusal` (still in `packages/cli/src/runtime/layout.ts`, now only upgrade's), `OLD_*` paths, `oldTickLockPath`, store's `layout.ts` and `old-layout.ts`, and harness `toOldLayout`/`layoutPlaces`/`oldNornDir` (used by `upgrade.test.ts`). These stay until 03 lands. Whichever of 03 and 05 merges second deletes the last importer, then these modules and the docs line in `docs/development.md` (Layout, Paths) that names `layout.ts`/`repoLayout`.
- `.agents/norn` may be spelled only through the harness helpers (repo lint (g)). The new test builds its old paths with `layoutPlaces`.

## Not proven yet
- The integration and e2e tiers run in CI. Review ran `pre-013-repo.test.ts` and the hook integration files locally: 16 pass.

## Notes
- Removed: the cli layout guard (`guardLayout`, `ctx.checksLayout`, `Command.layout` and every `layout: false`), the hook's layout check, doctor's layout-only early return, its `layout` key and its `ok layout` markdown line, `layout-guard.test.ts`, and the harness `toNewLayout`, whose last user was that test.
- `norn init` on a pre-0.13 repo now treats it as having no team file and records the version. No criterion covers this.

## Resume
Review #1 approved with no findings; QA of the three criteria is next.
