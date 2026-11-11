## Goal

Prepare release 0.32.0: the changelog section, the version bumps, the skill copies and pr.md. The issue is renamed "Release 0.32.0".

## Proof

- `CHANGELOG.md` has `## [0.32.0] - 2026-11-11` (Added, Changed, Fixed) above 0.31.0.
- `packages/cli/package.json` version, the README badge (`release-v0.32.0-blue`) and `norn_version` in `.agents/norn.config.yaml` read 0.32.0. `git grep 0.31.0` in those files finds nothing.
- `.agents/skills/norn*` match `packages/cli/assets/skills/norn*`. The copy loop changed nothing, and no folder is no longer bundled.
- `pr.md` has the version, its reason and the changelog section.

## Easy to miss

- The README badge's alt text is "Latest release", not "Release vX.Y.Z" as the release skill says. It was left as it is, and only the version in the badge changed.

## Not proven yet

- The person has not yet judged the version and the changelog at the `ready` gate.

## Notes

Version 0.32.0, proposed (the issue's `## Version` is empty). It is a minor release because the workflow schema gains `exits` (Added) and the shipped `ci` check changes how it routes (Changed).

Where each commit since v0.31.0 went:
- #334, "ci check waits 5m for a conflicting PR" (gh-327, `quick`, not labelled reproduce): one entry under Added (the check `exits` key) and one under Changed (the shipped `ci` check sends a conflicting PR to `update`).
- #333, "CI cancels sibling shards" (gh-326, `quick`): omitted. It only touches this repo's own CI (`.github/workflows/ci.yml` and `.agents/scripts/ci-failures.sh`), and nothing of it ships to users.
- #332, "Bypass: norn story reset removes the story's run state" (gh-331): Fixed.
- `norn: gh-327 done`, `norn: gh-326 done` and `norn: gh-328 done` (norn's bookkeeping): omitted.

Skills changed: none.

## Resume

Nothing is left to do in prepare. Next comes norn's draft PR, its CI, and the person at `ready`.
