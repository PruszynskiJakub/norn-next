## Release 0.31.0

**0.31.0 (minor, proposed):** `norn upgrade --json` changes shape and repositories below norn 0.30 are refused with new exit-3 refusals (machine contract), `norn migrate` and the pre-0.30 migrations are removed, and unit worktrees move into the machine dir.

## [0.31.0] - 2026-11-10

### Changed

- norn assumes every repository starts at norn 0.30. `norn upgrade` moves a repository from 0.30 on: it refreshes the skills, writes `norn_version`, stages the change and creates the labels. A repository that records no `norn_version`, or one below 0.30, is refused by every acting command, `norn upgrade`, `norn init`, `norn doctor`'s version check and `norn watch` (`version_missing` or `version_too_old`, exit 3), and told the one way forward: `norn init`, or install norn 0.30.x, run `norn upgrade`, commit, and upgrade again.
  - `norn upgrade --json` reports `norn_version`, `skills`, `staged`, `commit` and `labels` instead of `moves`, `config`, `run_state` and `gitattributes`.
- Unit worktrees live in the checkout's machine dir (`~/.norn/repos/<repo>-<hash>/worktrees/`), next to its run state; norn no longer creates a `<repo>-worktrees/` folder beside the repository. Wiping the machine dir removes the worktrees too: observe ignores a worktree whose folder is gone, and intake leaves a story whose branch is already on the remote to `norn story checkout`.
- The story's handoff is `handoffs/story.md` in its spec folder, not `handoffs/_story.md`. A story in flight keeps its handoff: norn reads the old name and moves it at the unit's next boundary commit. Finished specs keep theirs.
- When the `ci` check fails, the rework brief says where the failures are (the run and check-run links, the failed job ids and the command that prints their annotations) instead of a log tail that could cut off the failing assertion.
- The shipped `norn-qa`, `norn-triage` and `norn-diagnose` skills hand their context-heavy work to subagents, as `norn-review` does: `norn-qa` checks independent criteria in parallel against one prepared environment, `norn-triage` has a subagent read the code, and `norn-diagnose` has one trace the code involved and, optionally, a fresh one propose hypotheses. Each does the work itself when it cannot start subagents.

### Removed

- `norn migrate`, the old-layout guard, `norn doctor`'s layout and run-state sections, and `norn upgrade`'s migrations from before 0.30 (moving the old layout, renaming config keys, stripping criteria `needs`, moving run state out of branch trees, editing `.gitattributes`). A config key an older norn used is refused, naming the key, its replacement and the file to fix.

### Fixed

- A story whose PR merged after its round reached `$done` is recorded done: the checkout whose round ran takes the claim back and the next sync runs the merge cleanup, so the story no longer stays in the cockpit's Needs you. Cockpit rows for a story with several items say what each asks for.
- A story whose own PR was squash-merged while it waited at a gate no longer reads as the base moving and opens a second PR for the same release: the gate waits for the next sync, which ends the story through the merge path, and opening a PR on a branch whose PR is already merged fails instead.
- In manual mode with no `norn watch` running, a reported step no longer keeps asking to start an agent: the inbox shows it under Running as waiting for the heartbeat, the "no heartbeat" Unblock item shows in any mode, and `norn brief`'s `already_reported` refusal says to run `norn tick` when `norn watch` is not running.
- `norn watch --human` prints a refusal from before its loop as markdown, not as a raw JSON line.

