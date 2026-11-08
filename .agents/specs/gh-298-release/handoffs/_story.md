## Goal

Prepare release 0.29.0: changelog section, version bumps, refreshed bundled skills, pr.md.

## Proof

- `CHANGELOG.md` has `## [0.29.0] - 2026-11-08` (Changed, Fixed).
- 0.29.0 is in `packages/cli/package.json`, the README badge, and `norn_version` in `.agents/norn.config.yaml`.
- `.agents/skills/norn*` match `packages/cli/assets/skills/norn*`. Only `norn-fsd-round` changed.
- `pr.md` holds the version, its reason and the changelog section.
- The issue is renamed "Release 0.29.0".

## Easy to miss

- A version given by the person in Rework wins: change the heading, the three bumps, pr.md and the issue title together.

## Not proven yet

- Nothing: release PR #299 merged at 2026-11-08T12:24Z, tag v0.29.0 exists, issue #298 is closed.

## Notes

- Version 0.29.0 (minor): users notice changed behaviour (a merge ends a unit at `$done`, owed base records stop after 3 refusals, `state.json` reads older shapes differently), and `records.json` gains `refusals` and `stopped_at`.
- How each commit since v0.28.0 was sorted:
  - 7282fff "Bypass: make norn's implicit state machines explicit (#297)", closes #296, bypass:
    - Changed: merge ends a unit at `$done`; owed base record stops after 3 refusals; `UnitState` union with legacy shapes read differently; pane state no longer ends a turn.
    - Fixed: Stop-hook block cap is atomic; the view judges claim ownership by heartbeat.
    - Omitted (pure refactors): the `sessionActivity` and `storyPhase` refactors.
- prepare#2 re-checked on HEAD 780213e (merged main 39a0dd2 = "Release 0.29.0 (#299)"): the branch has no diff from origin/main, no commits since v0.29.0, every file already carries 0.29.0 and `.agents/skills/norn*` match the bundled sources; nothing to change.
- Friction: after #299 merged, the unit went ready.stale → update → prepare instead of ending; a re-run prepare has nothing to release.
- The README badge alt text stays "Latest release": it carries no version, as in 0.28.0.

## Resume

Nothing left: 0.29.0 is released. The unit should end; a person closes it if norn does not.
