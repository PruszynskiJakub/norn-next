## Release 0.20.0

**Version:** 0.20.0 (from the issue's `## Version`). It agrees with the rule: a minor, because `init`/`upgrade` behaviour changes and the machine contract changes (`init --json` and `upgrade --json` gain a `labels` object).

This PR also sets `norn_version: 0.20.0` in `.agents/norn.config.yaml` and refreshes `.agents/skills/norn*` from the bundled sources (only `norn-triage` changed). Once it merges, every machine working on this repo needs norn 0.20.x.

## Changelog


### Changed

- `norn init` and `norn upgrade` create every label norn uses on the remote: the intake label `norn`, one `norn:wf:<name>` per valid workflow (repo-local ones included) and the twelve triage labels `norn:kind:*`, `norn:risk:*` and `norn:priority:*`, each with a description. They never restyle, edit or delete a label: one already there is left alone, and an unused `norn:wf:*` is listed with its `gh label delete` command.
  - `upgrade` checks the labels on every run, even with nothing else to do. A missing remote, a logged-out `gh` or `glab`, a failed listing or a denied create is reported with what to run (the full `gh label create …` command for a label not created) and never changes the exit code. `init` no longer prints a `gh label create norn` hint.
  - `init --json` and `upgrade --json` gain a `labels` object: created, existing, unused and not created (reason and command), or `checked: false` with the reason.
  - `norn doctor` warns on a missing or unused label, and when it cannot reach the remote; `doctor --repo` never touches it. A tick still creates no label.
- The shipped `triage` step judges each issue's kind, risk and priority, gives a reason for each in its `## Triage` comment, and puts one label from each set on the issue, never overriding one already there (GR10, GR11).

