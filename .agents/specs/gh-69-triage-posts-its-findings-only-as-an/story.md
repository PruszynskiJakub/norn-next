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
workflow: quick
status: done
intake_at: 2026-10-27T22:36:49.724Z
body_hash: 34d2c2dd8b9c12a47a9959d1e0ae26e99a1a64b6d91ee97a5011c580a9862bfb
merge:
  pr: 81
  url: https://github.com/PruszynskiJakub/norn-next/pull/81
  head_sha: 4ea35648c8a07ca8854da0b1ec9019e6791aa6b2
  merge_commit_sha: 71f79bac4d698e9b16237f426638998d1afbbd49
  merged_by: PruszynskiJakub
  merged_at: 2026-10-28T15:13:43.000Z
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

## Triage

**Still occurs:** yes — on base 3c5ada5 the triage workflow and skill still tell `explore` to write the findings into `story.md` and post them as a comment (this very run did both, as the current skill requires).
**Repro:** `sed -n 16,21p .agents/norn/workflows/triage.yaml` → "Write the findings … into the body of story.md … and post them as an issue comment"; `grep -n "story.md" .agents/skills/triage/SKILL.md` → lines 3, 12, 26, 65.
**Affected code:**
- `.agents/norn/workflows/triage.yaml:2-3,16-21` — header comment and `explore` instructions write into story.md
- `.agents/norn/workflows/triage.yaml:31` — `confirm` gate prompt reads the findings "in story.md (also posted on the issue)"
- `.agents/skills/triage/SKILL.md:3,26-53,65` — description, section 3 "Write `## Triage` in `story.md`", Rules ("The only file you change is `story.md`"); section 4 then says "Post the same"
- **Not in the issue:** `.agents/norn/workflows/fix.yaml:17` ("Start from the triage findings in story.md") and `.agents/norn/workflows/quick.yaml:17` ("The spec is story.md: the issue and the triage findings") also read the triage from story.md. They must point at the issue comment (`gh issue view <N> --comments`) too, or fix/quick lose the findings.
**PRD:** none — the workflows and skills are repo-local (AGENTS.md Decisions, W8/W9).
**Context:** gh-61 is the example of the duplicate. No comments on #69. `CONTRIBUTING.md:9` does not mention story.md, so it needs no change.

**Recommend:** quick — edits to four repo-local files (triage.yaml, triage SKILL.md, fix.yaml, quick.yaml), no code and no open design question; the issue already says where the findings live.
**Run:** `norn workflow gh-69 quick --to implement`
