---
id: gh-94
slug: intake-by-kind-triage-for-stories
provider: gh
number: 94
url: https://github.com/PruszynskiJakub/norn-next/issues/94
title: "Intake by kind: triage for stories, reproduce for bugs; remove fix and spec"
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:quick
workflow: quick
status: new
intake_at: 2026-10-29T10:58:15.394Z
body_hash: f5007a9316be6f8ac4f12c9d138209bad70fc78c9529273bbb676f7f6fd8ae3c
---

## Observed

Every issue starts in `triage`, which recommends one of `fix | quick | story | spec | close`. Bugs then go through `fix`, which repeats the triage run in a separate `reproduce` session and then has its own copy of the `quick` tail. `spec` (PRD-only changes) adds a workflow with two person gates on the same diff (`approve-spec`, `ready`).

## Wanted

Intake by kind of issue, one delivery workflow for small changes:

- **`triage`** is for stories and features only. Outcomes `quick | story | close`.
- **New `reproduce` workflow**, triage for bugs, read-only on code. One agent step with skill `norn-diagnose`. It follows the report through the real interface (`bun packages/cli/src/main.ts …` in a throwaway repo under `$TMPDIR`), builds a loop that goes red on the symptom, minimises it, confirms the cause and names the seam for a regression test. It posts all of that as an issue comment and in the handoff. Outcomes `reproduced` / `cannot_reproduce`, both to a `confirm` gate where the person switches to `norn workflow gh-N quick --to implement` or closes the issue.
- **`quick`'s `implement`**: when the handoff or the issue comment has a red loop from `reproduce`, it becomes a failing test at the named seam before any code changes.
- **Delete `fix.yaml` and `spec.yaml`.** PRD changes go through `story` (refine amends the PRD) or `quick`.
- **Routing:** create the `norn:wf:reproduce` label and add a GitHub bug-report issue template that applies it. The `issue` skill sets it for bugs.
- **Changelog mapping in the `release` skill:** `norn:wf:reproduce` (the story's first workflow) → Fixed; drop `fix` and `spec`.
- **Docs:** update AGENTS.md (workflow list in Process and Decisions, the "`spec` workflow amends the PRD" line, the changelog mapping), CONTRIBUTING.md, the `triage` and `issue` skills, and `test/repo.test.ts`.

Depends on the `ci` step from #93.

## Where

- `.agents/norn/workflows/triage.yaml`, `fix.yaml`, `spec.yaml`, `quick.yaml`
- `.agents/skills/triage/SKILL.md`, `.agents/skills/issue/SKILL.md`, `.agents/skills/release/SKILL.md` (section table)
- `AGENTS.md` (Process, Decisions), `CONTRIBUTING.md`
- `.github/ISSUE_TEMPLATE/` (new)

## PRD

W8, W9, S7. No rule changes; repo-local workflows only.
