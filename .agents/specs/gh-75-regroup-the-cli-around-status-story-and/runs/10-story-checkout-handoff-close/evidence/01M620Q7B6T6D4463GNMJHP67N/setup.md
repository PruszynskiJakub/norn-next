# Setup (all evidence)
Dev CLI `bun packages/cli/src/main.ts` via wrapper `qa/bin/n <machine>` (agent/herdr env stripped; own NORN_HOME_DIR, NORN_MACHINE per clone).
Fake `gh` on PATH (qa/bin/gh) logs every call: issue list/view return open issue #7 (labels norn, norn:wf:mini), pr list [].
Bare remote qa/remote.git; clones A (alice) and B (bob). Workflow mini: plan=check step that commits slice 01-form, slices, open-pr; slice workflow: one gate `try`.
Ticks on A: intake → claim → start_unit → run_check → apply_receipts → start_slices; slice gh-7/01 parked at its gate.
Second remote qa/remote2.git + clone C, same setup, for close --yes (AC3).
