## Release 0.23.0

**Proposed version: 0.23.0 (minor).** Reason: the release has Changed entries — a drifted unit is no longer held and `brief`/`story start`/`story chat` no longer refuse with `skills_drift` (SK1, BS9, #254) — and before 1.0 anything under Changed is a minor bump.

Commits since v0.22.0:

- #254 (bypass #253) → Changed: skills drift no longer holds agent steps.
- #247 (bypass #242) → Changed (one bullet): faster `tick`/`status`, doctor timeout note; the rest is internal refactoring.
- `38649d1bc` norn: gh-243 done → omitted (norn bookkeeping commit for the previous release story).

Bundled skill copies in `.agents/skills/norn*` already matched their sources; none changed.

## [0.23.0] - 2026-11-06

### Changed

- A unit whose worktree holds bundled skills that differ from the running norn's is no longer held (SK1, BS9). It runs on its worktree's copies, as it keeps its pinned workflow (S7), until a merge of the base brings the new ones in. Before, every story cut before a release that changed a bundled skill and whose base merge conflicted could never leave `resolve`.
  - `brief`, `story start` and `story chat` no longer refuse with `skills_drift`.
  - The inbox shows such a unit as a Check item, not Unblock, and `story update-branch` is no longer offered for it. The main checkout's own drift stays an Unblock item naming `norn upgrade`.
- `tick` and `status` read each story's run state once, and the claim and mailbox refs of all stories in one batch, so they run faster on repos with many stories and receipts. A `norn doctor` probe that times out ends with a "timed out after Ns (killed)" note.
