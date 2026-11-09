# gh-305 · Release

### Goal

Prepare release 0.30.0: changelog section, version bumps, bundled skill copies, pr.md, issue title.

### Proof

- `CHANGELOG.md` has `## [0.30.0] - 2026-11-09`; `packages/cli/package.json`, the README badge and `norn_version` in `.agents/norn.config.yaml` read 0.30.0.
- `.agents/skills/norn*` copied from `packages/cli/assets/skills/norn*`; `git status` shows only the six changed skills.
- `bun run test` and `bun run typecheck` green.

### Easy to miss

- The README badge's alt text is "Latest release", not a version, so only the badge URL changes.

### Not proven yet

- The person judges version and changelog at `ready`.

### Notes

- Proposed 0.30.0 (minor): Added and Changed entries, and the `--json` brief's `mode_note` → `where` is a machine-contract change. `## Version` in the issue was empty.
- Commits since v0.29.0:
  - #304 norn's agent instructions (gh-301, `story`) → Added (hook refusals, post-compact notes, retro proposals) and Changed (rule reasons, Where you run, `--json` `where`, precedence and subagent rules, `norn-review` rewrite, dropped duplicate skill lines).
  - `norn: gh-301 done (PR merged)` → omitted (norn bookkeeping).
- Skills refreshed: norn-diagnose, norn-implement, norn-merge, norn-prototype, norn-retro, norn-review. None added or removed.

### Resume

Nothing left in prepare; next is the draft PR's CI and the `ready` gate.
