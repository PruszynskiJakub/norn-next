# Release 0.11.0

**Version:** 0.11.0, from the issue's `## Version`. It is a minor release in any case: the release has Changed (intake writes `spec.md`, a persisted-format change) and Removed (the Claude Code plugin) entries, and before 1.0 those make it minor.

**Omitted from the changelog:** #86 (repo test scripts and repo-local workflows), #81 (repo-local triage skill), #66 (golden test naming), #63 (this repo's self-hosting bootstrap), and the `norn: … done` bookkeeping commits.

## [0.11.0] - 2026-10-28

### Changed

- Intake writes a story's spec file as `spec.md` instead of `story.md` (GR2). A spec folder an older norn wrote, holding only `story.md`, keeps working: every reader and writer (`brief`, decide, act intake, story criteria, the GR6 done record on the base) takes `spec.md` when it exists and falls back to `story.md`, and nothing renames it. `storyFile` in `@norn/store` picks the file; `intake_story`'s `story_file` now names `spec.md`. An older norn reads a folder intaken from now on as `story.md missing` and marks the unit corrupt (S2), so everyone on a repo upgrades together.

### Removed

- The Claude Code plugin (`norn@norn` from the marketplace, with its `/norn` command) and the `sync:plugin` and `check:plugin` scripts that kept its version in line with `@norn/cli`. Existing installs stop getting updates. Agents start as before, with "Use the norn skill, then run `norn brief`": `norn init` already links the skills into `.claude/skills/` (SK1). The Herdr plugin is unchanged.

### Fixed

- A check step no longer runs inside the tick that starts it. The tick starts a detached `norn check-run <run_id>` that holds the check lease and returns at once, so `norn watch` keeps ticking while the check runs: the heartbeat stays fresh (no false "no heartbeat" in `norn inbox`), claims are renewed, and up to `max_checks` checks run in parallel (K1). The check writes its receipt when it ends and the next tick applies it (C5); a check-run that dies leaves a dead lease, which is reclaimed and the check runs again (K3). A step timeout still fails with reason `timeout`. `norn status` and `norn inbox` show the step as `(check running)` with its age.
- Every claim renewal due in a tick goes to the remote in one `git push`, so a tick renewing N claims makes one round trip instead of N (H5); a checkout holding 10 claimed stories spent 27–42 s on each renewal tick. One lost claim still fails only its own story, and a network failure fails every renewal in the batch (R1.2).

