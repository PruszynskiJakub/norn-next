## Goal
No command checks for, names or moves the pre-0.13 layout. A repo holding only `.agents/norn/` counts as a repo with no team file, so the missing-version refusal stops it. Doctor has no layout section.

## Proof
- AC1 (acting command on a pre-0.13 repo exits 3 with `version_missing`, old files untouched): `packages/cli/test/integration/pre-013-repo.test.ts` › "an acting command exits 3 with version_missing, and every old file is where it was, unchanged". Red first: before the change, `old_layout` came back.
- AC2 (an agent hook does not refuse on the layout): same file › "an agent hook in a unit worktree does not refuse on the layout". It passed before the change too, because the hook used to return `{}` on an old layout. Now the hook just goes on as on any repo.
- AC3 (doctor has no layout section or key, nothing mentions an old layout or `norn migrate`, markdown and `--json`, full and `--repo`): same file › "a pre-0.13 repo: no layout key…" and "a repo from 0.30 on: the same". Red first: `repo.layout` was present.
- `bun run test` (1736 pass) and `bun run typecheck` are green. I also ran the upgrade, hook and doctor integration files locally: all green.

## Easy to miss
- Upgrade (slice 03) still uses the layout: `repoLayout`, `layoutRefusal` (still in `packages/cli/src/runtime/layout.ts`, now only upgrade's), `OLD_*` paths, `oldTickLockPath`, store's `layout.ts` and `old-layout.ts`, and harness `toOldLayout`/`layoutPlaces`/`oldNornDir` (used by `upgrade.test.ts`). These stay until 03 lands. Whichever of 03 and 05 merges second deletes the last importer, then these modules and the docs line in `docs/development.md` (Layout, Paths) that names `layout.ts`/`repoLayout`.
- `.agents/norn` may be spelled only through the harness helpers (repo lint (g)). The new test builds its old paths with `layoutPlaces`.

## Not proven yet
- The integration and e2e tiers run in CI. I ran only the files listed above locally.

## Notes
- Removed: the cli layout guard (`guardLayout`, `ctx.checksLayout`, `Command.layout` and every `layout: false`), the hook's layout check, doctor's layout-only early return, its `layout` key and its `ok layout` markdown line, `layout-guard.test.ts`, and the harness `toNewLayout`, whose last user was that test.
- `norn init` on a pre-0.13 repo now treats it as having no team file and records the version. No criterion covers this.

## Resume
Review this slice's diff against its three criteria.
