## Release 0.21.0

Minor: gh-195 adds the team key `record.policy` and changes persisted formats (run state leaves `runs/` on the branch for the machine dir and `refs/norn/runs/<story>`), and gh-196 adds the skills `norn-fsd`/`norn-fsd-round` and `--delegated` with new receipt fields.

Omitted: norn bookkeeping commits (`norn: gh-N done`) and the `norn upgrade` config move (410db1475, internal).

## [0.21.0] - 2026-11-05

### Added

- **Run state stays on the machine that runs the story (gh-195).** A unit's state, receipts, pinned workflow, check logs and QA evidence now live in the checkout's machine dir (`~/.norn/repos/<id>/`), not in `runs/` on the story branch. The story branch and its PR carry only the work and the handoff.
  - When the record has to leave the machine, norn packs it into one commit on the per-story ref `refs/norn/runs/<story>`. No branch and no normal clone carries that ref.
  - New team key `record.policy`: under `local` (the default) the record is pushed when the claim is released (`story handoff`, a clean `watch` exit, `story close`), when `open-pr` opens or updates the PR, and once at the end as the archive. Under `remote` it is also pushed at every step boundary. A release whose record push fails releases nothing.
  - `story checkout` unpacks the record from the ref and goes on where it was. With no record (a `local` holder that died), it restarts the last step from the branch with fresh counters and says the record was lost. A rewritten branch restarts the current step as a new attempt.
  - Another machine's `story view` and `status` read the step from the ref, or from the last boundary commit with a line saying where the record is. A mailbox receipt that no longer matches the step becomes a Check item on the holder.
  - Each unit's handoff is its own file under the spec folder's `handoffs/`, prose only (Goal, Progress, Resume): no generated header and no heartbeat block. The brief shows that status instead.
  - `run list`, `run view` and `norn-retro` read a finished story's archive from its ref on any machine. `story reopen` unpacks it.
  - Migration: the first tick moves an open story's run state off its branch. `norn upgrade` moves each finished story's run state from the base branch into its archive ref and stages its removal; when a story's ref push fails, nothing is removed for it. `norn init` adds no `runs/**` line to `.gitattributes`.
  - `norn tidy` also cleans old session logs, cleared rejected mailbox receipts and records set aside as superseded. The "work not in the record" Check items and `orphaned/` folders are gone.
- **Supervised delivery: the bundled skills `norn-fsd-round` and `norn-fsd`.** An agent in the main checkout supervises the stories a person names: `norn-fsd-round` takes each through its current round, and `norn-fsd` (person-only) takes it end to end across rounds.
  - `story approve`, `story reject`, `story answer`, `run rerun` and `story edit --workflow` take `--delegated`, which needs `--reason` (SK3). A delegated command is refused inside a unit worktree (`delegated_in_unit`, exit 3).
  - Receipts gain an optional `delegated: true`; answer and round receipts gain `comment`. `story answer` and `story edit --workflow` take `--reason`.
  - `run list` and `run view` mark delegated decisions with their reason. `story view` gains a `## Delegated (N)` section, and `status` a delegated count per story. `status --json` gains `delegated_counts` and `heartbeat` (`up` says whether a `watch` ticks here). A delegated decision is never an inbox item.

