## Release 0.28.0

**Version 0.28.0** (proposed; the issue names none): minor, because the release changes behaviour. Story rework is now reviewed, a re-review checks the earlier findings first, and stray listeners are stopped before an agent step. The tick trace also gains `stopped_listeners`.

## [0.28.0] - 2026-11-08

### Changed

- In the `story` workflow, story-level rework (after `test.fail`, `qa.fail`, `human-qa.reject`, `ci.fail` or `ready.reject`) now goes through a `review` step before it is checked again and reaches the PR: `implement` → `review` → `test`, with `changes_requested` sending it back to `implement` (counter `review_loop`, max 3). A round without rework never runs it.
- A re-review checks the previous review's findings first, fixed or not: the `review` steps of `quick`, `slice` and `story` take `last_findings` as an input, and the brief lists the earlier findings under Inputs. After `changes_requested`, `implement` reworks only blocking and major findings; minor and nit findings are listed as notes and cost no further round.
- The shipped `norn-review` skill applies a security checklist (`SECURITY.md`: injection, secrets, process spawning, env loading, tokens, CI workflows, persisted data) to the hunks of a diff that touch the paths the repo's `REVIEW.md` marks sensitive. Breaches are blocking findings on the Standards axis.
- Before a fresh agent session starts (`start_run`, `retry_fresh`), norn stops what an earlier session left listening on the unit's slot ports from its worktree, by the same port and working-directory rule as before a check. The action's detail in the tick trace lists them (`stopped_listeners`). A resumed session keeps its servers.
- The skills-drift item in a unit's Check says the worktree's copies are used until the base is merged in or until the branch's own edit to them is reverted.

### Fixed

- A Claude session that loses its login mid-step parks on an ask that says "agent logged out — run `/login` in the pane", instead of being classified silent and nudged until `stuck`. `norn` now installs Claude's `StopFailure` hook.
- An open story PR follows its issue's title, as it follows `pr.md` for its body, so a release PR opened as "Release" becomes "Release X.Y.Z" at the next sync after `prepare` renames the issue. On GitLab a draft MR keeps its `Draft: ` prefix. The `ready` gate no longer checks the title.

