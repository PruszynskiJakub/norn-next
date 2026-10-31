---
id: gh-125
slug: the-ci-check-passes-before-the-pr-s-ci
provider: gh
number: 125
url: https://github.com/PruszynskiJakub/norn-next/issues/125
title: The ci check passes before the PR's CI run has started
assignee: PruszynskiJakub
labels:
  - friction
  - norn
workflow: triage
status: active
intake_at: 2026-10-31T10:32:11.564Z
body_hash: 096b8531f0786949069e0b96c95eba2c523230d47158dde54fa9bbefd8f9dfe3
---

## Observed

Release 0.13.0 (gh-122, PR #123): the `ci` step passed and the story reached `ready` while the PR's CI workflow had not yet registered a run. `gh pr checks` listed only `process` (pull_request_target, passes in ~7 s) and `automerge` (skipped). The wait loop breaks as soon as `gh pr checks` succeeds, which happens once any one check exists, and `gh pr checks --watch` then sees every listed check finished and exits 0. The real CI run (`check`, `package`) started about a minute later. It happened to pass; a red run would still have left the story at `ready`.

## Wanted

The `ci` step passes only on a green run of the CI workflow (`ci.yml`) for the PR's head commit, and fails on a red one. It waits for that run to appear instead of accepting whatever checks exist at the moment.

## Repro

1. Open a story PR (any `quick`, `story` or `release` story reaching `open-pr`).
2. Within the first ~30 s, `gh pr checks` lists only `process` and `automerge`; the `ci` step exits 0.
3. `norn story view gh-N` shows `ready` while `gh run list --branch <branch> --workflow ci.yml` still shows the run pending.

## Where

The same script in three workflows:
- `.agents/workflows/release.yaml:49`
- `.agents/workflows/quick.yaml:66`
- `.agents/workflows/story.yaml:109`

## PRD

None directly; this is the repo's own workflow check scripts.
