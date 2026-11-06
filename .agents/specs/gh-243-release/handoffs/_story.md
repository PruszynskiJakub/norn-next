## Goal

Prepare release 0.22.0: changelog section, version bumps, `norn_version`, bundled skill copies, pr.md, issue title.

## Progress

- Must include #241: merged.
- Commits since v0.21.1 on `origin/main`, and their section:
  - `9b4629335` #241 (gh-226, quick) norn-review verify pass + `REVIEW.md`, `norn init` writes a starter `REVIEW.md` → **Changed** (two bullets: the skill, and init).
  - `59caff9f2` #240 (gh-212, quick) way out of a run-out counter, `park.counter`, `run rerun` warning → **Changed**.
  - `cf04092b6` #239 (gh-234, quick) this repo's `REVIEW.md` and PR template sections → **omitted** (docs only, repo-internal).
  - `56dea726f` #238 (gh-224, quick) a step agent's approve/reject refused with `gate_by_agent` → **Fixed** (it was recorded as the person's).
  - `7e4f5a433`, `7ac89db32`, `0c697d368`, `eb33f1b32` `norn: gh-… done (PR merged)` → omitted (norn bookkeeping, no PR).
- Version: none in the issue, no Rework → proposed **0.22.0** (minor): Changed entries, plus machine-contract changes (`park.counter` in `state.json`, `warning` in `run rerun --json`, `review` in `init --json`).
- Bumped `packages/cli/package.json`, README badge, `norn_version` in `.agents/norn.config.yaml`.
- Bundled skills refreshed: only `norn-review` changed; none removed.
- pr.md written; issue renamed to "Release 0.22.0".
- prepare#1 done: Propose 0.22.0: minor, since there are Changed entries and machine-contract changes (park.counter in state.json, run rerun --json warning, init --json review). 0 Added, 3 Changed (#240, #241 skill + init), 1 Fixed (#238); omitted #239 (docs only). norn-review skill copy refreshed; issue renamed Release 0.22.0.

## Resume

Nothing left for `prepare`; the PR's CI and the `ready` gate come next. On a rework with another version, change the CHANGELOG heading, the three bumps and pr.md to it.
