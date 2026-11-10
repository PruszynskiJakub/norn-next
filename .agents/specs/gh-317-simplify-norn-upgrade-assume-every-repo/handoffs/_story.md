# gh-317 — handoff

## Goal

Planned spec for "assume every repo starts at 0.30": upgrade only moves a repo from 0.30 on, a missing or pre-0.30 `norn_version` is refused everywhere with the 0.30 path, and the old migrations go.

## Proof

- spec.md holds the Plan: two seams (S1 the CLI through the test harness, S2 core's pure version rule), a coverage table for all 24 user stories, one prefactor, decisions D1–D12, testing decisions and risks.
- The person agreed: init refuses a pre-0.30 version too (stories 16 and 17 amended), config old-key messages lose their "run `norn upgrade`" hint, two codes `version_missing` / `version_too_old`, and the status version item becomes an Unblock item pointing to `norn doctor`.

## Easy to miss

- The harness's `h.config(...)` drops `norn_version` today; it must keep it first (the prefactor), or most integration tests get refused.
- The baseline refusal's wording lives in one core function beside `versionMismatch` (D1); the guard, `watch`, upgrade, doctor, init and the inbox item all use it.
- Removing `branch_record`/`tree_root` from the types lets `tsc` find every branch-tree reader (snapshot, observe, decide, act, view).
- Flat records and older `state.json` readers stay (out of scope).

## Not proven yet

- Nothing built. How many e2e repos and fixtures lack `norn_version` is unknown until the first full test run.

## Notes

- Earlier decisions (person, refine): branch-tree run state goes; refusal in guard, upgrade, doctor and init; doctor drops its layout section; `upgrade --json` keeps only `norn_version`, `skills`, `staged`, `commit`, `labels`; other legacy readers are a follow-up audit.
- #316 (the upgrade crash fix) ships in the same release, so there's no 0.30.1 precondition.
- Release notes (story 24) come from commit messages and the PR body; CHANGELOG is the release step's.

## Resume

Slice the planned spec (the next step), with the harness prefactor first.
