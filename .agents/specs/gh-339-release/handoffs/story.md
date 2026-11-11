### Goal

Prepare release 0.33.0: changelog section, version bumps, refreshed bundled skills, pr.md.

### Proof

- `CHANGELOG.md` has `## [0.33.0] - 2026-11-11` (Added, Changed) above 0.32.0; no `[Unreleased]`.
- `packages/cli/package.json` version, README badge (`release-v0.33.0`) and `norn_version: 0.33.0` in `.agents/norn.config.yaml` carry 0.33.0.
- `.agents/skills/norn*` copied from `packages/cli/assets/skills/norn*`: only `norn-merge` changed; no skill dropped from the bundle.
- `pr.md` in the spec folder: the version, its reason and the changelog section.

### Easy to miss

- The README badge's alt text is "Latest release" (no version in it), so only the badge URL changed.

### Not proven yet

- The issue is not renamed to "Release 0.33.0": the norn PreToolUse hook refused `gh issue edit 339 --title "Release 0.33.0"` although the brief allows it. A person should run it.

### Notes

Version: 0.33.0, proposed (the issue's `## Version` is empty). Minor because #338 adds things (the `merge` step type, the light `update` path, `regenerate`, `base.verify`) and changes push behaviour and a refusal of `norn story edit`.

Commits since v0.32.0, with their section:
- bc7784ba6 #338 (gh-337, workflow `story`, not reproduce): Added and Changed.
- d11b4f5ca, 7d956944b `norn: gh-N done (PR merged)`: omitted, norn bookkeeping.

Friction: the norn hook blocks the one remote write (the issue rename) that the release brief and skill allow.

### Resume

Rename the issue by hand (`gh issue edit 339 --title "Release 0.33.0"`), then the `ready` gate judges the version and changelog.
