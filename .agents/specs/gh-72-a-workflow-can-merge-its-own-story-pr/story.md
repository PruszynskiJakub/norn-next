---
id: gh-72
slug: a-workflow-can-merge-its-own-story-pr
provider: gh
number: 72
url: https://github.com/PruszynskiJakub/norn-next/issues/72
title: A workflow can merge its own story PR
assignee: PruszynskiJakub
labels:
  - norn
workflow: triage
status: new
intake_at: 2026-10-27T23:06:49.894Z
body_hash: ff7b508d188cbc8a0f9ae7a78f93d7fb6a5ff6f5f5623035c51040d59b5a95e3
---

## Observed

GR5 says a person merges the story PR, and every workflow here ends at a `ready` gate where a person
merges by hand. Came up while designing the runs model in #71: once a story is a sequence of runs
and only a merge ends it, a workflow could end with the merge itself, behind a gate a person
approves, instead of the person switching to GitHub to click merge.

## Wanted

Decide whether a workflow may merge its story PR, e.g. a `git: merge` action placed after a gate,
and under what rules. To settle:
- GR5 ("a person merges the story PR") and the AGENTS.md process ("a person merges the PR"): does a
  person approving a gate right before the merge count?
- Merge method (squash only here) and the commit message (PR title and body).
- The CI process check, and branch protection / required checks: what to do when the merge is refused.
- GR6 and BS11: a merge norn made must look like any other merge, so cleanup runs the same way.

Parked from #71; the runs model does not depend on it.

## PRD

GR5, GR6, BS11, W2 (`git` actions), W8 (`git` actions only on a story).
