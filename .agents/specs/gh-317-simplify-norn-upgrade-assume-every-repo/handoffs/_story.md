#### Goal

"Assume every repo starts at 0.30": upgrade only moves a repo from 0.30 on, a missing or pre-0.30 `norn_version` is refused everywhere with the 0.30 path, and the old migrations go.

#### Proof

- All six slices are integrated (01 harness, 02 baseline guard, 03 slim upgrade + `norn migrate` gone, 04 doctor/init baseline, 05 no old layout, 06 no branch/base-tree run state). The unit tier and typecheck pass (test#1).
- QA #1 ran every criterion through the dev CLI in throwaway repos. The evidence pack (report.md, criteria.json, findings.json, one file per area) is in this run's evidence. The results:
  - 30 of 32 criteria `pass`: the guard (tick and story start refuse with nothing changed; a config error still exits 6; watch pauses mid-run; status shows an Unblock item pointing to `norn doctor`), upgrade (skills, relink, version, staging, commit text, labels via a stub gh, no-op, interrupted rerun, the three refusals, five-field JSON, legacy files left alone, `migrate` unknown), doctor and init on the baseline, a pre-0.13 repo, and `runs/` in branch and base trees ignored.
  - 03.AC11 (docs describe upgrade from 0.30 on, nothing on the removed migrations): was **fail** (F1); fixed in implement #1 (see below), to be re-checked by QA.
  - 06.AC4 (golden corpus: only the record-move cases gone, transcripts unchanged): **person**. The golden part holds (four cases and two rule cases gone, 132 replay green, snapshots unchanged), but `test/e2e/transcripts/recovery-claim-lost.txt` lost one line: the branch-tree `runs` read (`git cat-file -e …/runs`), which is the reader this slice removes.

#### Easy to miss

- F1 is fixed: the clause "`norn upgrade` rewrites old files" is gone from `docs/reference.md` (config paragraph) and the last sentence about base-branch run state being moved into the refs by `norn upgrade` is gone from `docs/concepts.md`. Both were hand-written prose outside the `docs:emit` block, so a grep over docs/ and README is the check: `grep -rn "rewrites old files\|moves it into the refs" docs README.md` finds nothing.
- Fixes keep the guard as it is: fix docs and fixtures, never weaken the refusal.

#### Not proven yet

- QA has not re-checked 03.AC11 (docs) since the F1 fix.
- A person has not yet ruled on whether the one-line transcript change satisfies 06.AC4.
- The integration and e2e tiers run in CI only.

#### Notes

- Earlier decisions (person): init refuses a pre-0.30 version too; config old-key messages lose their "run `norn upgrade`" hint; codes `version_missing` / `version_too_old`; the status version item is an Unblock item pointing to `norn doctor`. Flat records and older `state.json` readers stay (out of scope).
- QA observation for a person: on a team file with no `norn_version`, `norn init` refuses with a do_instead that starts "run `norn init` if norn was never set up here", which is circular coming from init itself (04.AC3 still passes as written).
- Also cleaned in implement #1: the dangling "held story whose record is still flat" comment in `packages/core/test/rule-cases.ts`, and the `norn_version` refusal in `config-edit.ts` now says upgrade "refreshes the bundled skills with it" (it no longer moves other files). Unit tier (1726 pass) and typecheck green; docs:emit leaves no diff.
- QA repro loop: in a throwaway repo under `$TMPDIR`, run `bun packages/cli/src/main.ts` with the session's `NORN_*`/`HERDR_*` env unset and `NORN_HOME_DIR` set to a temp dir. A "newer norn" is a copy of the worktree with `packages/cli/package.json` at 0.31.0.
- Release notes come from commit messages 5e8451d29 and b45b051f0 (checked) and the PR body. CHANGELOG is the release step's.

#### Resume

Re-run QA on 03.AC11 (the grep above); a person rules on 06.AC4 (the one removed branch-tree `runs` read in `test/e2e/transcripts/recovery-claim-lost.txt`).
