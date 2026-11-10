## Goal

Prepare norn 0.31.0: changelog section, version bumps (package.json, README badge, norn_version), refreshed bundled skills, pr.md, issue renamed to "Release 0.31.0".

## Proof

- `CHANGELOG.md` has `## [0.31.0] - 2026-11-10` (Changed, Removed, Fixed) above 0.30.0.
- `packages/cli/package.json` version, README badge `release-v0.31.0-blue` and `norn_version: 0.31.0` in `.agents/norn.config.yaml` are bumped.
- `.agents/skills/norn*` match `packages/cli/assets/skills/norn*`. Copies that changed: norn-diagnose, norn-qa, norn-triage (subagents, #307) and norn-retro (handoff renamed to story.md, #310). None was dropped.
- `pr.md` in the spec folder has the version, its reason and the section.
- `bun run test` (1739 pass) and `bun run typecheck` are green.

## Easy to miss

- The branch is one commit behind origin/main (#325). That commit touches only README line 77, not the badge, and no bundled skill, so the skill copies are correct and the merge is clean.
- The README badge's alt text is "Latest release", with no version in it, so it was left as it is.

## Not proven yet

- **The issue title is still "Release".** The hook refused `gh issue edit 328 --title "Release 0.31.0"` even though this step allows it, so the person must run it. The PR picks up the title at the next sync.

## Notes

Version 0.31.0 (minor, proposed): `norn upgrade --json` changes shape and repositories below 0.30 are refused with new exit-3 refusals (machine contract); `norn migrate` and the pre-0.30 migrations are removed; worktrees move into the machine dir.

Commit → section:
- #325 Simplify norn upgrade (story, #317) → Changed (baseline 0.30, refusals, upgrade --json) + Removed (norn migrate, old migrations, doctor sections)
- #320 Worktrees in the machine dir (story, #318) → Changed
- #310 Handoff renamed to story.md (bypass) → Changed
- #324 CI check points to the failures (quick, #321) → Changed (users see it in the rework brief)
- #307 Skills use subagents (quick, #303) → Changed
- #323 Merged-after-round story never recorded done (quick, #294) → Fixed
- #322 Squash-merged release PR opens a second PR (quick, #319) → Fixed
- #313 Manual mode without heartbeat (bypass) → Fixed
- #316 upgrade ENOTDIR / watch --human (bypass) → Fixed, watch --human part only (#325 removed the code the upgrade part fixed)
- `norn: gh-N done` commits → omitted (bookkeeping)
- None was labelled `norn:wf:reproduce`.

Friction: the PreToolUse hook refuses the one remote write the release prepare step allows (`gh issue edit --title`).

## Resume

At `ready`: the person judges 0.31.0 and the changelog, and renames issue 328 to "Release 0.31.0" if that hasn't happened yet.
