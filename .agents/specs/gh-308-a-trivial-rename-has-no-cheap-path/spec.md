---
id: gh-308
slug: a-trivial-rename-has-no-cheap-path
provider: gh
number: 308
url: https://github.com/PruszynskiJakub/norn-next/issues/308
title: A trivial rename has no cheap path through norn
assignee: PruszynskiJakub
labels:
  - friction
  - norn
  - norn:wf:refinement
workflow: refinement
status: new
intake_at: 2026-11-11T21:00:14.930Z
body_hash: be12e7af433de85befb8f88d7868da07e41050d40cf363ecf1c9cf2fff41ce21
---

## Observed

A one-file rename (the story's handoff `handoffs/_story.md` → `handoffs/story.md`) has no path through norn cheaper than a full `quick` round: intake, claim, worktree, checks, review and PR for a change whose whole diff is one path function, a fallback move and the references to it. The person chose the bypass for it instead.

## Wanted

A cheap path through norn for a trivial, low-risk change, so it doesn't need the bypass.
