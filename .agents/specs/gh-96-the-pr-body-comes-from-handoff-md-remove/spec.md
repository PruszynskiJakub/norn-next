---
id: gh-96
slug: the-pr-body-comes-from-handoff-md-remove
provider: gh
number: 96
url: https://github.com/PruszynskiJakub/norn-next/issues/96
title: The PR body comes from handoff.md; remove the describe step and pr.md
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:story
workflow: story
status: new
intake_at: 2026-10-29T10:58:15.394Z
body_hash: 3361cb8be93fd6e3cbe16527e24140e3ab53b191f807731de5af39a2c7ee13c3
---

## Observed

The PR body is written by a separate agent step, `describe` (skill `norn-pr`), into `<spec_dir>/pr.md`, which `open-pr` reads (GR9). That is about a minute of work, but in manual mode the step waits until someone starts its session. On 2026-10-28 the wait before `describe` was 17 min (gh-69), 68 min (gh-60), 60 min (gh-70) and 4 h 12 min (gh-77): the longest idle time in every story. The trace shows `agent.ready.manual` throughout. The agent before it already has everything the body needs, and keeps `handoff.md` current anyway.

## Wanted

- No `describe` step and no `pr.md`. `handoff.md` gets a `## PR` section (summary picture, before/after evidence, merge danger) that the agent steps keep current, like the rest of the handoff.
- `open-pr` takes that section as plain text in act (decide only names it, P8) and puts the issue link under it. With no section, the body is the link alone, as today. On an open PR it replaces the body, so after a rework the PR still describes the branch as it is now.
- `review` checks the `## PR` section like any other finding: missing evidence or a stale summary is a blocking finding.
- `norn-pr` becomes the guidance for writing that section (used by `implement`, `qa` and `prepare`), not a step skill.
- Amend PRD GR9 and the default story sketch. Remove the `describe` steps from the repo workflows (`quick`, `story`, `release`) and from the shipped templates in `packages/cli/assets`. Remove `PR_BODY_FILE` if nothing else uses it.

## Where

- `packages/cli/src/runtime/act/git-step.ts:11` (`prBody`), `:103`
- `packages/schema/src/ids.ts:216` (`PR_BODY_FILE`)
- `.agents/PRD.md:130` (`pr.md` in the layout), `:342` (default story sketch), `:357` (GR9)
- `packages/cli/assets/skills/norn-pr/`, `packages/cli/assets/` workflow templates, `packages/cli/assets/skills/norn/` (handoff sections)
- `.agents/norn/workflows/{quick,story,release}.yaml`

## PRD

GR9 (changed), P8, §5 (handoff).
