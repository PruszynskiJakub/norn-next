---
id: gh-70
slug: rename-story-md-to-spec-md
provider: gh
number: 70
url: https://github.com/PruszynskiJakub/norn-next/issues/70
title: Rename story.md to spec.md
assignee: PruszynskiJakub
labels:
  - norn
workflow: triage
status: new
intake_at: 2026-10-27T22:36:49.724Z
body_hash: b597efcf65f30b03feaef7b4d34f84c6edd9f040ce25fddd31999afc366514d1
---

## Observed

The file intake writes under `.agents/specs/<id>-<slug>/` is `story.md` (`storyFile`, `packages/store/src/paths.ts:34`). It holds the mirrored issue and, after `norn-refine`, the spec. norn is spec-driven: the folder is `specs/`, the skills refine, plan and slice a spec. But the file is named after the story, not the spec.

## Wanted

The file is `spec.md`: intake writes it, every reader (store, view, cli, skills, workflows, PRD, docs) uses it. Story folders already holding a `story.md` (units in flight, on other collaborators' machines too) keep working: either read both names or migrate on the next tick. Which one is part of this issue.

## Where

- `packages/store/src/paths.ts:34` — `storyFile`
- `packages/schema/src/frontmatter.ts:37` — `StoryFrontmatter` doc comment
- 23 files under `packages/*/src`, `packages/cli/assets`, `.agents/PRD.md`, `README.md`, `AGENTS.md`, `CONTRIBUTING.md` mention `story.md`
- `.agents/norn/workflows/*.yaml`, `.agents/skills/triage/SKILL.md` — repo-local mentions

## PRD

GR2 (intake writes `story.md`), GR8 (body tracking), W9 (`workflow:` in `story.md`), the layout at PRD lines 128 and 146, and the `norn-refine` row in the skills table (SK table, line 432). A persisted-format rename, so before 1.0 it is a minor bump (CHANGELOG preamble).
