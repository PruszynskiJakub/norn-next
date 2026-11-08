---
id: gh-249
slug: the-release-pr-opens-titled-release
provider: gh
number: 249
url: https://github.com/PruszynskiJakub/norn-next/issues/249
title: The release PR opens titled "Release" although prepare renamed the issue to "Release X.Y.Z"
assignee: PruszynskiJakub
labels:
  - friction
  - norn
  - norn:kind:bug
  - norn:priority:medium
  - norn:risk:medium
  - norn:wf:quick
workflow: quick
status: active
intake_at: 2026-11-07T22:33:43.386Z
body_hash: 07cfeeea1162bce13b136e272daaa7be0921ee47cca9b19b5c52430ef442ab45
---

## Observed

In the 0.22.0 release (gh-243), `prepare` renamed issue #243 "Release" → "Release 0.22.0" at 09:35:16Z, and `open-pr` opened #244 at 09:36:43Z titled "Release". `open-pr` takes the title from the story's mirrored frontmatter (`fm.title`), which the GR8 mirror had not yet updated; it updated later (the spec frontmatter on main now says "Release 0.22.0"). Once the PR is open, norn updates its body but never its title. The squash commit takes the PR title, so the PR had to be renamed by hand before merging.

The `ready` gate prompt asks the person to check the title only "if a rework changed the version", but this happens on every release whose version prepare proposes.

## Wanted

The PR title follows the issue's current title: `open-pr` uses the title as it is on the remote, or an open PR gets the mirrored title as it already gets the new body (GR9). Then the gate prompt's title check can go.

## Repro

Run `release` with the Version left empty; when `open-pr` has run, `gh pr view <n> --json title` says "Release" while `gh issue view <n> --json title` says "Release X.Y.Z".

## Where

- `packages/core/src/decide/steps.ts:133` (`title: fm.title`)
- `.agents/workflows/release.yaml:71` (gate prompt), the repo-local `release` skill (the rename)

## Rules

GR8 (issue edited → mirrored title), GR9 (open PR gets the new body), BS0.
