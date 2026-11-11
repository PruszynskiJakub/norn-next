## Release 0.32.0

Proposed version **0.32.0** (minor): the workflow format gains `exits` on check steps (Added), and the shipped `ci` check sends a conflicting PR to `update` (Changed). The issue named no version.

## [0.32.0] - 2026-11-11

### Added

- A check step can name an outcome for an exit code in `exits` (`exits: { 3: stale }`) and route it like any other outcome. Exit 0 is still `pass`, and any other exit code, a timeout included, is still `fail`. A check that declares no `exits` works as before.

### Changed

- The `ci` check in the shipped `story` and `quick` workflows first asks whether the PR conflicts with its base. A conflicting PR goes to `update` at once as `stale` (counted on `stale_loop`). Before, it waited 5m for a CI run GitHub never starts and then went to `implement` on `ci_loop`. When no run shows up for a PR that does not conflict, the failure gives the PR's mergeable state.

### Fixed

- `norn story reset` removes the story's run state from the machine dir, and `--json` reports it as `run_state_removed`. Before, a reset story that had run a step was taken in again but never claimed, and `norn story view` kept showing its old step and outcome.

