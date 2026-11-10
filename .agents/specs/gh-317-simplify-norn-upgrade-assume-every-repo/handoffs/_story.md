## Goal

Refined spec for "assume every repo starts at 0.30": upgrade only moves a repo from 0.30 on, a missing or pre-0.30 `norn_version` is refused everywhere with the 0.30 path, and the old migrations go.

## Proof

- spec.md holds Problem Statement, Solution, 24 user stories, Out of Scope, Further Notes; no open questions. The person confirmed the interview summary.

## Easy to miss

- A missing `norn_version` is now refused by every acting command (exempt: init, help, doctor, upgrade); test repos and fixtures without `norn_version` will need one.
- `norn init` records a version only when it creates the team file; an existing team file without `norn_version` is refused.
- Flat records and older `state.json` shapes stay: archive refs keep records as written. Only the issue's map plus branch-tree run state (snapshot `branch_record`, first-tick move off the branch) go.

## Not proven yet

- Nothing built yet; planning comes next.

## Notes

- Decisions (person): branch-tree run state goes; refusal in guard + upgrade + doctor + init; doctor drops its layout section, no old-file detection; `upgrade --json` drops `moves`, `config`, `run_state`, `gitattributes`; other legacy readers are a follow-up audit.
- The person said the upgrade-crash fix (#316) ships in the same release as this change, so there's no 0.30.1 precondition. The do_instead still says "install norn 0.30.x".

## Resume

Plan the spec (`norn-plan`) once a person starts the next step.
