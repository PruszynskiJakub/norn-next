---
id: gh-74
slug: rename-the-core-noun-story-to-a-word
provider: gh
number: 74
url: https://github.com/PruszynskiJakub/norn-next/issues/74
title: Rename the core noun "story" to a word that fits every workflow
assignee: PruszynskiJakub
labels:
  - norn
workflow: triage
status: active
intake_at: 2026-10-28T08:40:06.888Z
body_hash: 18797b35d95b553363d8e89dae5764743b86f7834844b367cb60cf4b99042d95
---

## Observed

"story" is the PRD's core noun (§5: "A remote issue … assigned to the user with the configured label. One spec folder, one story branch, one story worktree, one draft PR"). It reads as agile user-facing work and fits awkwardly for the `fix`, `quick`, `spec` and `release` workflows, which are not stories. People think in "issue #12", so the CLI makes them translate between issue and story. This came up while reworking the command surface to be more intuitive (gh-style `norn <noun> <verb>`), where the noun is what a person types most.

## Wanted

One noun for the bundle norn builds around an issue (spec, branch, worktree, PR, runs, claim) that:
- reads right for every workflow (feature, fix, spec, release);
- stays distinct from the remote issue, so closing or reopening it plainly means norn's work, not the GitHub/GitLab record (GR7: closing the issue parks the story; dropping the story leaves the issue open);
- does not clash with gh/glab nouns (`issue`, `pr`, `run`);
- still pairs with `slice`.

Candidates so far:
- **change** (Gerrit/Jujutsu sense: what lands as one PR) is the current favourite.
- **story**: keep it, and accept issue numbers as keys instead.
- **work** and **card**: weaker.
- **ticket** is excluded: it is a banned synonym (AGENTS.md glossary rule, linted by `test/repo.test.ts`), and it names the tracker record, not the work.

The decision covers the rename's reach: glossary only, or also persisted names (`story.md`, `StoryFrontmatter`, story branches/worktrees, the `story` workflow), and how units in flight keep working.

## Where

- `.agents/PRD.md:58` (§5 glossary); "story" appears on 82 lines of the PRD
- `AGENTS.md:82`: glossary rule and banned synonyms
- `test/repo.test.ts`: glossary lint
- `packages/schema/src/frontmatter.ts`: `StoryFrontmatter`; `packages/schema/src/ids.ts`: story keys, branch/dir names
- `packages/store/src/paths.ts`: `storyFile`
- `packages/cli/assets/workflows/story.yaml`, `.agents/norn/workflows/story.yaml`
- 104 files under `packages/*/src` mention "story"
- Related: #70 (rename `story.md` → `spec.md`): decide together, so the file is not renamed twice

## PRD

§5 glossary first; then every rule that names a story (GR1–GR9, T1, W8–W9, MO1–MO5, BS9 and others), the layout at lines 128/146, and the CLI command table (§15). A persisted-format rename, so before 1.0 it is a minor bump.
