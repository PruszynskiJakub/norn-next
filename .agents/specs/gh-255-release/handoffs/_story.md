### Goal

Prepare release 0.23.0: changelog section, version bumps, bundled skill copies, PR body, issue title.

### Progress

- Proposed 0.23.0 (minor): #254 changes SK1/BS9 behaviour (drifted units no longer held, `skills_drift` refusals gone), which is Changed; before 1.0 Changed means minor. Issue `## Version` was empty.
- Commits since v0.22.0:
  - e55310775 #254 (bypass #253) → Changed.
  - c207e7c01 #247 (bypass #242) → Changed, one bullet for the user-visible bits (faster tick/status, doctor timeout note); internal refactors otherwise omitted.
  - 38649d1bc `norn: gh-243 done` → omitted (norn bookkeeping for the previous release).
- Bumped `packages/cli/package.json`, README badge, `norn_version` in `.agents/norn.config.yaml` to 0.23.0.
- Bundled skills: no `norn*` copy changed (copies already matched sources); none removed.
- pr.md written; issue renamed to "Release 0.23.0".

### Resume

Nothing left in prepare; at `ready` the person judges the version and the changelog.

## Progress

- prepare#1 done: Propose 0.23.0: #254 changes SK1/BS9 (drifted units no longer held, skills_drift refusals gone) — Changed means minor before 1.0. 0 Added, 2 Changed, 0 Fixed; omitted 38649d1bc (norn bookkeeping). Bundled skill copies already matched; issue renamed to Release 0.23.0.
