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
workflow: quick
status: done
intake_at: 2026-10-27T22:36:49.724Z
body_hash: b597efcf65f30b03feaef7b4d34f84c6edd9f040ce25fddd31999afc366514d1
merge:
  pr: 85
  url: https://github.com/PruszynskiJakub/norn-next/pull/85
  head_sha: cfd8e2f60245d62b3ddc0ae6e1aa781d96566a75
  merge_commit_sha: 28e1c132d47dd632d72f46a778769397ee4984a8
  merged_by: PruszynskiJakub
  merged_at: 2026-10-28T16:07:12.000Z
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

## Triage

**Still occurs:** yes — base `ba2dc5d`: intake still writes and every reader still reads `story.md`.
**Repro:** `grep -rln 'story\.md' packages/*/src packages/cli/assets .agents/PRD.md README.md AGENTS.md CONTRIBUTING.md .agents/norn/workflows .agents/skills` lists 31 files outside tests (plus about 70 test files, golden cases and transcripts). `storyFile` returns `join(specDir, "story.md")`.
**Affected code:**
- `packages/store/src/paths.ts:34` — `storyFile`, the one path helper.
- The name is also hardcoded outside `storyFile`. These are the places a dual read or a migration would miss: `packages/core/src/decide/index.ts:107` (`story_file` in the intake action), `packages/cli/src/commands/brief.ts:187` (the brief's spec input), `packages/cli/src/runtime/agent-unit.ts:96` (criteria for the story unit), `packages/cli/src/runtime/record.ts:46` (the done record on the base, GR6).
- `packages/store/src/snapshot.ts:133` — a missing file shows as `story.md missing`, and the unit goes `corrupt` (S2). An old norn that reads a folder holding only `spec.md` reports the unit corrupt.
- Text: `packages/schema/src/frontmatter.ts:37`, `packages/core/src/{actions,criteria,policy,brief}.ts`, `packages/core/src/inbox/items.ts:543,698` (the inbox item id `corrupt:<story>:story.md`), `packages/cli/src/commands/drop.ts`, `packages/cli/src/runtime/act/{index,lifecycle}.ts`, `packages/view/src/types.ts:104`, `packages/cli/assets/workflows/story.yaml`, `packages/cli/assets/skills/norn-retro`, README.
- Repo-local: `.agents/norn/workflows/{triage,fix,quick,story,spec}.yaml`, `.agents/skills/{triage,release}/SKILL.md`.
**PRD:** GR2, GR6 (done record `status`/`merge:` in the file on the base), GR8, W9, S2, the layout in §7 (PRD lines 128 and 146), the `norn-refine` and `norn-plan` rows of the skills table (lines 432 and 434).
**Context:**
- **Self-hosting constraint.** The released norn delivers this change and reads this story's own `story.md` while it runs. If the branch renamed this folder's file, the running norn would see `story.md missing` and mark the unit corrupt. Any PR that renames a file has to go out in two releases: first a norn that reads both names, then the rename of existing files, or else this story keeps `story.md`. Other collaborators run older releases too, so mixed versions on one repo have to be designed for.
- `main` has no `.agents/specs/` folders yet, so no merged done records exist to migrate today.
- Golden cases carry their own workflow text. Renaming the bundled workflows changes no existing golden case. Tests that write `story.md` fixtures and the transcripts will change on purpose.
- The issue leaves the compatibility choice open: read both names, or migrate on the next tick. A migrating tick is a new effect: it writes, commits and pushes a rename, and that touches P6, S5 and T7 (only the holder pushes).

**Recommend:** story — a persisted-format rename across every package, with an open design question (dual read vs migration, mixed norn versions, the two-release order) and PRD text to amend (GR2, W9, §7, the skills table). It needs a refined spec and a plan before code. It is too wide for quick and has code, so it is not spec.
**Run:** `norn workflow gh-70 story --to refine`
