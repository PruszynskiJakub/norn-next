## Goal

Prepare release 0.25.0: changelog section, version bumps, skill copies, pr.md and the issue title.

## Progress

- Commits since v0.24.0, sorted:
  - #270 skills reshape (gh-267, `quick`): Changed (the shipped skills users' agents load).
  - #269 bypass, hand-off latency (#265): Changed (watch re-ticks at once, H12, and wakes on receipts, H13; `norn-slice` keeps `depends_on` shallow) and Fixed (`recover.commit` failing every tick).
  - #268 integration test hang (gh-215, `quick`, not `reproduce`): omitted, test harness only.
  - `norn: gh-N done (PR merged)` commits: omitted, bookkeeping.
- Version 0.25.0 (proposed): minor, because there are Changed entries and `norn tick`'s JSON gains `follow_up`.
- Bumped `packages/cli/package.json`, the README badge and `norn_version` in `.agents/norn.config.yaml`.
- Skill copies: `.agents/skills/norn*` already matched `packages/cli/assets/skills/norn*`; no skill changed in this diff.
- `bun run test` is green (1281 pass) after `bun install` in this worktree.
- Issue renamed to "Release 0.25.0".
- prepare#1 done: Propose 0.25.0: minor, Changed entries (watch re-tick/wake H12/H13, reshaped shipped skills) and tick JSON gains follow_up. 0 Added, 3 Changed, 1 Fixed; omitted #268 (test harness only) and norn bookkeeping commits. Skill copies already matched.

## Resume

Nothing left in prepare; the next action is the person's judgement at `ready`.
