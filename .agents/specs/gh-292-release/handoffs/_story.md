### Goal

Prepare release 0.28.0: the changelog section, the version bumps and refreshed skill copies, and a pr.md that names the version and the reason for it.

### Proof

- CHANGELOG.md has `## [0.28.0] - 2026-11-08` with Changed (5) and Fixed (2) entries.
- packages/cli/package.json `version`, the README badge (`release-v0.28.0-blue`) and `norn_version` in .agents/norn.config.yaml all say 0.28.0. `git grep 0.27.1` finds none of the old version left in those files.
- .agents/skills/norn* match packages/cli/assets/skills/norn*. Only `norn-review` changed (SKILL.md, plus the new SECURITY.md).
- `bun run test` (1308 pass) and `bun run typecheck` are green.
- The issue is renamed to "Release 0.28.0".

### Easy to miss

- The README badge's alt text is "Latest release", as in earlier releases, not "Release v0.28.0". Only the badge URL changed.

### Not proven yet

- The release PR's CI.

### Notes

Version 0.28.0, proposed because the issue's Version section is empty. It is a minor release because it has Changed entries: story rework is reviewed, a re-review checks earlier findings, listeners are stopped before agent steps, and the trace gains a `stopped_listeners` detail.

Each commit since v0.27.1 and the section it went to (all delivered by `quick`; none is labelled `norn:wf:reproduce`):
- #283 Story rework gets reviewed before it reaches the PR (gh-227) → Changed
- #287 A re-review checks the earlier findings first; minor findings cause no rework (gh-225) → Changed
- #286 norn-review security checklist for sensitive paths (gh-228) → Changed
- #290 Stray listeners stopped before an agent step (gh-32) → Changed
- #288 CI refuses edits to installed skill copies outside a release (gh-248) → Changed, for the skills-drift hint wording only. The CI process check is this repo's own (scripts/process-check.ts) and is left out.
- #289 Claude session that loses its login parks on an ask (gh-111) → Fixed
- #291 Release PR title follows the issue title (gh-249) → Fixed
- `norn: gh-N done (PR merged)` bookkeeping commits → left out

Friction: the worktree had no node_modules, so `bun install` was needed before `bun run test`.

### Resume

Nothing left to do in prepare. At `ready`, the person judges the version and the changelog.
