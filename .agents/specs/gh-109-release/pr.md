## Release 0.12.0

**Proposed version: 0.12.0** (minor). Reason: before 1.0 anything Added, Changed or Removed makes a minor release, and #106 regroups the CLI (old command names removed with no aliases) and adds `story create`, `story reopen`, `run cancel` and `config set|unset`.

Commits since v0.11.1: #106 → Added, Changed, Removed. Omitted: #105, #104, #102 (quick; they change only this repo's own workflows, skills, docs and repo tests, nothing shipped); 9d8676a (direct cleanup of QA evidence committed on main).

## Changelog

## [0.12.0] - 2026-10-30

### Added

- `norn story create` opens an issue on the remote, labels it `norn` and `norn:wf:<workflow>`, assigns it to you and takes it in. Without `--title` it asks for one at a terminal and opens `$EDITOR` for the body; `--web` opens the remote's new-issue page instead. An unknown `--workflow` is refused before anything is created.
- `norn story reopen` undoes `story close`: it takes the claim again here, re-creates the worktree from the pushed branch and puts the unit back at its step. A unit that was running comes back `stuck` with reason `reopened`, so `norn run rerun` starts it.
- `norn run cancel` stops a unit's agent without dropping the story. It writes a `stuck` receipt before the kill (P6), keeps commits, uncommitted work, branch and claim, and `norn run rerun` resumes it in a fresh session.
- `norn config set <key> <value>` and `norn config unset <key>` write the user or repo config file (`--user`, `--repo`; asked at a terminal). Keys are dotted, values are YAML, and an unknown key or invalid value leaves the file as it was. Comments and key order are kept.
- `norn run attach [<unit>]` focuses a unit's agent pane under Herdr.

### Changed

- **Breaking: the CLI is regrouped around three nouns, modelled on `gh`.** `norn help` lists them first (Core), then Setup (`init`, `doctor`, `config`, `uninstall`), Background (`watch`, `sync`, `tidy`) and the agent protocol, which is unchanged (`brief`, `done`, `ask`, `stuck`). `tick`, `hook` and `status --segment` are listed only by `help --all`; `norn help story reject` or `--help` on any verb prints that verb's usage.
  - `norn status` is what needs you (the old `inbox`, same flags); `status --watch` is the cockpit and `status --watch --pane` opens it in a Herdr split. A one-time notice on stderr points to `story list` for the story table.
  - `norn story list | view | create | answer | approve | reject | update-branch | start | chat | edit | checkout | handoff | close | reopen`: `story list` is the old `status` table, `story view` merges `status <key>` and `orient`, `story reject --reason` replaces `approve --reject`, `story update-branch` is `update`, `story start` is `open`, `story chat` is `orient --open`, `story edit --auto|--manual` and `story edit --workflow <name> [--at <step>]` replace `mode` and `workflow`, and `story checkout`, `story handoff` and `story close` replace `take`, `release` and `drop`.
  - `norn run list | view | attach | rerun | cancel`: `run list` is `trace`, `run view` is `why` (`--why`, `--receipt`), `run rerun [--step <step>]` is `unstick [--to]`, `run attach --next` is `cockpit --next`.
  - `norn config list` and `config get <key>` replace `config [<key>]`.
  - A verb's target is optional: an explicit key, else the unit of the worktree you are in (its story for story-only verbs), else a pick-list at a terminal of only the units the verb applies to. Under `--json`, with no TTY or in an agent session, a missing target is refused with exit 2 (`target_required`) and `do_instead` lists the candidates.
  - Every command norn prints (status items, `do_instead` hints, handoff headers, briefs, `doctor` and `init` next steps), the docs, the shipped skills and PRD §15 use the new names. `--json` shapes, receipts, `state.json` and traces are unchanged; `story list --json` and `status --json` print what `status --json` and `inbox --json` printed.
- The Herdr plugin (0.4.0) calls the new commands: its cockpit pane and actions run `norn status --watch`, `status --watch --pane` and `run attach --next`. Update it together with the binary; an older install calls `norn cockpit` and `norn open`, which no longer exist.

### Removed

- The old command names, with no aliases: `inbox`, `cockpit`, `orient`, `open`, `answer`, `approve`, `update`, `mode`, `workflow`, `take`, `release`, `drop`, `trace`, `why` and `unstick` now exit 2 as unknown commands, and `norn status` no longer prints the story table. The map from each old name to its replacement is above.

