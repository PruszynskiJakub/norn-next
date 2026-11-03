## Release 0.19.0

**Version:** 0.19.0 (from the issue's `## Version`). It agrees with the rule: a minor, since this release adds `norn_version` and `norn story wait`, renames `norn migrate` to `norn upgrade`, and changes the machine contract (new exit code `7`, `version_mismatch` refusals, `brief --json` `checks`).

This PR also sets `norn_version: 0.19.0` in `.agents/norn.config.yaml` (the first release to do so, B27) and refreshes `.agents/skills/norn*` from the bundled sources. Once it merges, every machine working on this repo needs norn 0.19.x: 0.18 and older refuse the repo with exit 6.

## Changelog


### Added

- **A repo records the norn version it needs: `norn_version` in `.agents/norn.config.yaml`.** `norn init` records the running version on a new repo; only `norn upgrade` changes it (`config set|unset norn_version` is refused with `written_by_norn`).
  - A binary that does not match (same minor before 1.0, patch at least the repo's) is refused with `version_mismatch`, exit 3, on every command that acts (`tick`, `sync`, `brief`, `story *`, `run rerun|cancel|attach`, `tidy`, `config set|unset`). A newer binary is pointed at `norn upgrade`. Commands that only read (`status`, `doctor`, `help`, `story list|view|wait`, `run list|view`, `config list|get`) run and show the mismatch; `init`, `upgrade`, `uninstall`, `done`, `ask`, `stuck` and `hook` always run. The version is read from the main checkout's team file, never a unit worktree's.
  - `norn watch` skips the ticks it may not run, sends one notification per version pair, and resumes when the versions match again.
  - Bundled `norn*` skills that differ from the running binary's hold the unit's agent steps (`agent.skills_drift`), and `brief`, `story start` and `story chat` refuse; checks, gates and base sync go on. The inbox names the fix: `norn upgrade` in the main checkout, `norn story update-branch` for a unit. Repo-local skills are never checked.
  - `norn doctor` and `doctor --repo` gain a `norn` version check, and a drifted skill now fails `doctor` (exit 1) instead of warning.
  - An older norn (0.18 and before) refuses a repo that has the key with `config_invalid`, exit 6: upgrade every machine before committing it.
- `norn story wait <story|slice> --until <condition> [--timeout <d>] [--interval <d>]` blocks until a story reaches a state and prints it as JSON, for supervisors. Conditions are `step=<name>`, `gate`, `ask`, `stuck`, `done` (the round ended) and `merged`; on a story, `gate`, `ask` and `stuck` also hold for one of its slices. It exits 0 when met and 7 on timeout or a stop signal (new exit code `timeout`); it ticks nothing.
- The brief of a step that follows a check lists the checks that ran since the last report (step, command, outcome, duration, log), so a reviewer sees what has and has not run; `brief --json` gains `checks` (null when none).

### Changed

- `norn migrate` is now `norn upgrade`: in the main checkout, with no tick running, it moves the repo's `norn_version`, the bundled skills that differ and any file migration in one staged diff, never moves the version backward (`version_backward`), and does nothing when the repo is already current. `norn migrate` still works as a deprecated alias, removed in the next minor.
- A person command that needs the tick lock (`story edit --workflow|--at`, `story checkout|handoff|close|reset|reopen`, `tidy`, and the claim release when `watch` stops) waits up to 60s for a running tick, with one line on stderr, instead of refusing `tick_locked` at once (H1). `tick`, `migrate` and `story edit --auto|--manual` still refuse at once.
- Shipped skills:
  - `norn-review` maps every Behaviour item and criterion to the test that proves it, writes the table into the handoff, and blocks on an item with no test unless its verifier is `agent` or `person`.
  - `norn-triage` and `norn-refine` back claims about code or config with the usages that consume them; `norn-implement` and `norn-tdd` read the existing test helpers before writing a test; `norn-interview`, `norn-refine` and `norn-clarify` state how a terse answer was read instead of asking again.

### Fixed

- Child processes are started with `Bun.spawn`, and synchronous captures write to temp files, working around two Bun bugs: a child whose exit was never reported hung the caller, and a lost `ps` output line made a live process look dead.

