---
id: gh-116
slug: triage-sets-risk-priority-and-kind
provider: gh
number: 116
url: https://github.com/PruszynskiJakub/norn-next/issues/116
title: Triage sets risk, priority and kind labels on the issue
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:story
workflow: story
status: new
intake_at: 2026-10-30T13:41:34.568Z
body_hash: c84e6306607a00226fd6f22cf6f5128f801c6e5d3302266754f10875f44449ef
---

## Observed

The `triage` skill posts a `## Triage` comment and recommends a workflow, but it is told "never label, assign or close" (`.agents/skills/triage/SKILL.md`, section 4). An issue leaves triage with no labels for its kind (bug, enhancement, chore, …), its risk or its priority. The person has to add them by hand, or they never get added, so nobody can filter or sort the backlog by them on GitHub.

## Wanted

Triage judges the issue and sets three labels on it:

- **kind**: one of bug, enhancement, chore, docs, … (the existing `bug`, `enhancement` and `documentation` labels could be reused, or a namespaced set like `kind:*` could be used)
- **risk**: e.g. `risk:low|medium|high`: how much the change could break (blast radius, one-way vs two-way door)
- **priority**: e.g. `priority:p0..p3`

It also gives the reason for each label in the `## Triage` comment (new `**Kind:**`, `**Risk:**` and `**Priority:**` lines), so the person can correct them at `confirm`. The reason this is needed: the person can sort and filter the backlog on GitHub without reading every triage comment.

Open questions for refine:
- The exact label sets and their names: reuse GitHub's defaults or use namespaced labels.
- Whether `reproduce` also sets kind, risk and priority for bugs, or only `kind:bug`.
- What happens on a rerun (`## Triage (updated)`): replace the earlier triage labels, and leave labels a person set alone.
- Who creates the labels on the remote if they are missing (overlaps with #67).
- Whether this stays repo-local (the triage skill is repo-local) or becomes a shipped norn feature.

## Where

- `.agents/skills/triage/SKILL.md`: section 3 (comment shape) and section 4 (the "never label" rule, and the one remote write allowed)
- `.agents/norn/workflows/triage.yaml`: the `explore` instructions and the `confirm` prompt
- `.agents/norn/workflows/reproduce.yaml`: "never edit the issue, label, assign or close"

## PRD

- W9: workflow selection by the `norn:wf:<name>` label. The new labels must not clash with it.
- GR7: an unlabelled issue parks the story. Triage must never remove `norn`.
- §20 deferred row "Write-back to GitHub/GitLab (… `norn:stuck` label)": v1 writes only pushes. A repo-local skill setting labels goes further than that.
- Related: #67 (norn init creates the labels norn needs), #71 (triage confirm gate).
