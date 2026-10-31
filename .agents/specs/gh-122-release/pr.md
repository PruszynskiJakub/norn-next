## Version

**0.13.0** (minor): `norn migrate`, `doctor --repo` and `tidy --retain` are Added, and the layout move and the chunked trace change the machine contract (persisted formats and paths, new refusal codes `old_layout`, `both_layouts`, `tick_pruned`, `retain_too_short`, and the `trace.retain` config key).

## Changelog

## [0.13.0] - 2026-10-31

### Added

- `norn migrate` moves a repository set up by an older norn to the new layout. Run it in the main checkout with `norn watch` stopped: it stages the moves of the config and workflows as git renames (no commit; it prints the commit to make), moves the trace, heartbeat, caches and hook files to this machine's folder for the checkout (the heartbeat id is kept, so claims taken before still count as this checkout's), and drops the old `.agents/norn/trace/` line from `.gitignore`. Run twice, it reports nothing to move. It refuses with exit 3 while a tick holds the lock (`tick_locked`), in a unit worktree (`not_main_checkout`), or when both layouts are present (`both_layouts`).
- `norn doctor` validates every workflow (W5) and the repo config before they merge, naming the file, the step or schema path and the cause, and exits 1 on a broken one. `norn doctor --repo` checks only the layout, workflows and config, needs no agent, runner or remote, and changes nothing.
- `norn tidy` prunes the trace: day files past `trace.retain` (a new config key, default and minimum `14d`; `tidy --retain <duration>` overrides it) and hook files of units with no live run. A window under `14d` is refused (`retain_too_short`, exit 3), a value that is not a duration too (`retain_invalid`) (O7). `norn run view --why` on a tick older than the retained trace refuses with `tick_pruned`.

### Changed

- **Breaking: norn's files move out of `.agents/norn/`.** Committed and machine-local files no longer share one folder:
  - The repo config is `.agents/norn.config.yaml` and the workflows are in `.agents/workflows/`. They are ordinary repo files: an agent may change them inside a step (the shipped `norn` skill now forbids only `runs/` and the generated top of handoff.md), a running unit keeps its pinned workflow (S7), and `norn init` writes this layout.
  - The trace, heartbeat, locks, caches and hook files live in the checkout's machine folder `~/.norn/repos/<name>-<hash8>/`, outside the working tree and `.git`; each clone gets its own. Moving a repository folder gives it a new machine folder; `norn doctor` warns and prints the `mv` that adopts the old one.
  - On the old layout every command but `migrate`, `doctor` (which reports it) and `help` refuses with `old_layout` and names `norn migrate`; with both layouts present they refuse with `both_layouts`. Old files left in a unit worktree are ignored.
  - **Upgrading:** after `norn migrate` is committed, an older norn cannot read the repository. Upgrade norn to this release or later on every machine that works on it; there is no compatibility path.
- `norn watch`, the cockpit and every tick no longer read the whole trace each cycle, so their memory stays flat on a large trace (it climbed to 8–21 GB) and the trace grows far more slowly (A2, A4, O4, O5, X1, X4):
  - `norn status`, `status --watch` and `status --segment` read no day file; timelines are loaded only by `norn run list` and `run view`, which skip event types they do not show.
  - Each unit's hook facts also go to its own hook file (`hooks/<story>/_story.jsonl`, `hooks/<story>/<nn>.jsonl`); a tick reads only the hook files of units with a live or recently changed run, and `norn brief` only its own. The first tick after the upgrade copies live runs' hook facts from the day files once.
  - A tick stores its facts as content-addressed chunks in a `<day>.chunks.jsonl` beside the day file, each written once a day, so a quiet tick writes a few KB instead of ~650 KB. `norn run view --why` replays chunked ticks and ticks written before the upgrade exactly.
