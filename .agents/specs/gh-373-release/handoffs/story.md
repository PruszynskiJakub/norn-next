## Goal

Prepare release 0.35.0: the changelog section, the version bumps, the bundled skill copies and pr.md.

## Proof

- `CHANGELOG.md` has `## [0.35.0] - 2026-11-17` (1 Changed, 5 Fixed).
- `packages/cli/package.json` version, the README badge and `norn_version` in `.agents/norn.config.yaml` are 0.35.0. `git grep 0.34.0` finds none left in those three files.
- `.agents/skills/norn*` copied from `packages/cli/assets/skills/norn*`. Only `norn-pr` changed, and no skill folder stopped being bundled.
- `pr.md` holds the version, its reason and the changelog section.

## Easy to miss

- The README badge's alt text is "Latest release", not "Release vX.Y.Z", so it carries no version and was left as it is.
- The issue's Note about restarting `norn watch` is in the fd-leak bullet under Fixed.

## Not proven yet

- The release PR's CI, and the person's verdict at `ready`.

## Notes

Version reason: minor. The `norn-pr` Door change is listed under Changed, and #366 adds the hook-trace event kind `background_wait` (a persisted format).

Commit → section (all five are bypass PRs; I sorted each one by the issue it bypasses):
- #364 (watch fd leak, ps probe; #358 `norn:wf:reproduce`) → Fixed, 2 bullets
- #366 (background subagents nudged; #359 reproduce) → Fixed
- #372 (usage limit parks the story; #362 reproduce) → Fixed
- #368 (workflow loader validation; #360 reproduce) → Fixed
- #370 (released-norn CI workflow; #361, not reproduce) → the norn-pr skill Door sentence is under Changed. The `.github/workflows/released-norn.yml` CI job is this repo's own and is omitted.

## Resume

Wait for the `ready` gate. If Rework names another version, follow the release skill's "Rework with another version" section.
