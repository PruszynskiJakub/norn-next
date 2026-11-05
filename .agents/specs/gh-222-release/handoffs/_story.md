## Goal

Prepare release 0.21.1: changelog section, version bumps, bundled skill copies, pr.md, issue renamed.

## Progress

- Must include #221: merged.
- Commits on main since v0.21.0, by section:
  - f59180d #221 (gh-73, `quick`, bug): Fixed — GR8 inbox item now fires for `norn-refine` refine steps.
  - d2b9e52 #220 (gh-139, `quick`, bug): Fixed — `--json` output over 64 KiB no longer cut off through a pipe.
  - 6eabb46 #219 (gh-214, `quick`): omitted — changes only this repo's `.agents/workflows/slice.yaml` and AGENTS.md; the shipped slice workflow is unchanged.
  - d82e996 (direct commit, `norn upgrade 0.21.0` in this repo): omitted — repo housekeeping.
  - bbd8801, ed2555d, d22e08f, 6bed132: norn bookkeeping commits, omitted.
- Version proposed: **0.21.1** (patch): only Fixed entries, no machine-contract change.
- Bumped `packages/cli/package.json`, README badge, `norn_version` in `.agents/norn.config.yaml`; added `## [0.21.1] - 2026-11-05` to CHANGELOG.md.
- Bundled skills: `.agents/skills/norn*` already matched `packages/cli/assets/skills/norn*`; none changed.
- Issue #222 renamed to "Release 0.21.1".
- prepare#1 done: Propose 0.21.1: patch, only Fixed entries since v0.21.0 (#221 GR8 body-changed inbox item for norn-refine, #220 --json over 64 KiB through a pipe), no contract change. 0 Added, 0 Changed, 2 Fixed; omitted #219 (repo-only slice workflow), d82e996 (repo upgrade commit). Bundled skills already matched.
- prepare#2: re-ran on HEAD after main's bbd8801 (bookkeeping, omitted); nothing new to release, no file changed.
- prepare#2 done: Propose 0.21.1: patch, only Fixed entries since v0.21.0 (#221 GR8 inbox item for norn-refine, #220 --json over 64 KiB through a pipe), no contract change. 0 Added, 0 Changed, 2 Fixed; omitted #219 (repo-only slice workflow), d82e996 (repo upgrade commit), bbd8801 and other norn bookkeeping. Rechecked on HEAD after update from main: nothing new; bundled skills already matched.

## Resume

prepare#2 rechecked on HEAD after the update from main (bbd8801, bookkeeping only): commit list, changelog, bumps, skills, pr.md and issue title all still hold. Next: the person judges 0.21.1 at `ready`.
