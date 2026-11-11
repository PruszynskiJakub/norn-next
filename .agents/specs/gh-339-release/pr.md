## Release 0.33.0

Proposed version **0.33.0** (minor): #338 adds the `merge` step type, the light `update` path, the `regenerate` config key and `base.verify`, and changes when norn pushes a story's branch; `norn story edit` gains a refusal (exit 3).

## [0.33.0] - 2026-11-11

### Added

- A `merge` step type: the story waits for a person to merge its PR, and the merge ends it. Its one outcome, `stale`, is taken by norn when the base moves under the story, and routes it back through `update` with a counter. In the shipped `story`, `quick` and `release` workflows `ready` approves to `merge` instead of `$done`, so a conflict after approval goes back through `update` instead of showing only as a merge item. Workflows without a `merge` step and `norn story update-branch` work as before.
- `update` takes a light path when nothing but base merges and spec-folder bookkeeping happened since the last approval:
  - `clean` (the base merged without a conflict): the test step runs on the merge, then `open-pr` keeps the PR body, and `ci` and `ready` follow with the approval carried over.
  - `resolved` (a conflict an agent resolved): the test step and a review of the resolution's remerge-diff run before `open-pr`, and `ready` asks for a fresh approval, showing the remerge-diff. An approval is never carried over a red check.
  - Implement work, a changed `spec.md` or an unrouted outcome since the last approval takes the full path, as before (`done`).
- The `regenerate` config key maps generated files to the command that writes them. When every conflicting path of a base update is mapped, norn takes the base's version of each, runs the commands and commits the merge with a `Norn-Regenerated` trailer, with no agent. An unmapped path or a failed command goes to `resolve` with the command's output in the brief. A story branch holding nothing but its own spec folder merges without an agent too.
- `base.verify: <check step>` in a workflow (`test` in the shipped `story` and `quick`) runs that check on the merge of a base move without a conflict under a story waiting at `ready` or `merge`. It runs once per base move, takes a check slot and pushes nothing. Red sends the story back through `update`, with the failing output as `last_check`.
- Two open stories whose changes conflict show as one Check item in `norn status`, naming both stories and the paths. Conflicts only in spec folders are skipped, and the item clears by itself.
- The resolver's brief lists the base side of a conflict (`base_side`): the base commits per conflicting path, with their story, spec and `pr.md`. The shipped `resolve` step takes it, and `norn-merge` reads it first. The resolver can `norn ask` with the merge in progress and resume with it after the answer.

### Changed

- Once a story's PR is open, a boundary pushes only `refs/norn/heads/<story>`, not the branch: the branch moves at `open-pr` and at `norn story close`, so a rework loop starts one CI run instead of one per boundary, and the PR head at merge is the commit `ci` watched. Approving `ready` and entering `merge` push nothing. With no PR open, the branch and the heads ref go in one push.
  - A takeover after a crash resumes from the heads ref merged with the remote branch. A person's push to the branch is merged with norn's local boundaries, never rebased. The heads ref is removed at cleanup, close and `norn tidy`.
- `norn story edit gh-N --workflow <name>` with the story's own workflow on a finished story whose PR conflicts with its base is refused (exit 3) with `do_instead: norn story update-branch gh-N`. A different workflow or `--at` still starts a round.
