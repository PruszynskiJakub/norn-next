---
id: gh-69
slug: triage-posts-its-findings-only-as-an
provider: gh
number: 69
url: https://github.com/PruszynskiJakub/norn-next/issues/69
title: Triage posts its findings only as an issue comment, never writes story.md
assignee: PruszynskiJakub
labels:
  - norn
workflow: triage
status: new
intake_at: 2026-10-27T22:36:49.724Z
body_hash: 34d2c2dd8b9c12a47a9959d1e0ae26e99a1a64b6d91ee97a5011c580a9862bfb
---

## Observed

The `triage` workflow's `explore` step appends a `## Triage` section to the story's `story.md` *and* posts the same text as an issue comment (gh-61: the section was appended to `.agents/specs/gh-61-…/story.md` and posted as a comment). So the findings live in two places, and the spec file a later `spec`/`story` workflow refines starts out holding triage notes rather than only the mirrored issue.

## Wanted

Triage writes its findings only as an issue comment. `story.md` stays as intake wrote it. The `decide` step (and anything after it) reads the triage from the issue comment (`gh issue view <N> --comments`), not from `story.md`. The skill's "only file you change" rule becomes "changes no file".

## Where

- `.agents/norn/workflows/triage.yaml:3,17-19` — explore instructions say to write into story.md
- `.agents/norn/workflows/triage.yaml:31` — decide reads the findings from story.md
- `.agents/skills/triage/SKILL.md:3,12,26,65` — description, section 3 "Write `## Triage` in `story.md`", Rules

## PRD

None: the workflow and skill are repo-local (W8, W9 decision in AGENTS.md).
