#### Goal

"Assume every repo starts at 0.30": upgrade only moves a repo from 0.30 on, a missing or pre-0.30 `norn_version` is refused everywhere with the 0.30 path, and the old migrations go.

#### Proof

- spec.md holds the Plan (seams S1 CLI via harness, S2 core's pure version rule; D1–D12) and, in its frontmatter `criteria`, every slice criterion (`01.AC1`…`06.AC4`, 32 in all).
- Six slice files in `slices/`, every user story cited by some acceptance:
  1. 01 harness keeps the recorded `norn_version` (prefactor; test) — depends on nothing.
  2. 02 acting commands refuse a missing / pre-0.30 version via one core rule; watch pauses, status shows an Unblock item (test, one agent for release-note commits) — after 01.
  3. 03 upgrade does only skills, version, staging, labels; refuses the baseline; five-field `--json`; `norn migrate` gone; docs (test, agent for docs and release notes) — after 02.
  4. 04 doctor's version check and init apply the baseline (test) — after 02.
  5. 05 no old-layout guard, hook check or doctor layout section; a pre-0.13 repo is stopped by the missing-version refusal (test) — after 02.
  6. 06 run state read only from the machine dir and archive refs; `move_record` and branch/base-tree readers go (test) — depends on nothing.
- Critical path: 3 slices (01 → 02 → 03/04/05). Startable at once: 01 and 06.

#### Easy to miss

- 02 makes every test repo without a recorded version refuse: fix the repos (record a version), never weaken the guard.
- 03 and 05 both touch upgrade's import of the old layout; whichever lands second removes the last import. 03 owns the store's archive-ref move of base-tree run state; 06 owns the rest of branch/base-tree run state.
- The baseline texts are pinned once in core (S2); cli tests assert the code and that the text is the rule's.

#### Not proven yet

- Nothing built. How many e2e repos and fixtures lack `norn_version` shows only when 02 runs the tiers (CI for integration/e2e).

#### Notes

- Plan checked against this base (after the main merge 4595edabc): every symbol D10 names exists where the plan says; the plan holds.
- Earlier decisions (person): init refuses a pre-0.30 version too; config old-key messages lose their "run `norn upgrade`" hint (in 03); codes `version_missing` / `version_too_old`; the status version item is an Unblock item pointing to `norn doctor`. Flat records and older `state.json` readers stay (out of scope).
- Release notes come from commit messages and the PR body (02 AC7, 03 AC12); CHANGELOG is the release step's.

#### Resume

The person approves the slices at the gate; then slices 01 and 06 start.
