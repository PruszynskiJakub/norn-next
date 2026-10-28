---
id: gh-73
slug: an-issue-body-edited-after-intake-never
provider: gh
number: 73
url: https://github.com/PruszynskiJakub/norn-next/issues/73
title: An issue body edited after intake never reaches a story in progress
assignee: PruszynskiJakub
labels:
  - friction
  - norn
workflow: triage
status: new
intake_at: 2026-10-28T07:20:06.336Z
body_hash: 6143be279eff629d1967d41def40be453085342963219a0d24c48719758a9a0c
---

## Observed

#71's body was rewritten on GitHub (Wanted: the runs model) after intake had mirrored it into
`.agents/specs/gh-71-…/story.md`. The edit changed only the frontmatter `body_hash`: story.md's
body is never overwritten (GR8), and no inbox item appeared. Triage, and then the `spec` run's
`refine#1`, worked from the old Wanted section. The triage comment posted at 23:04 recommends
the three old options and says nothing about runs, and nothing told the person or the agent.

Two gaps:
1. **Before refine finishes, a body change is silent by design.** GR8 only raises
   "issue body changed since refine" after refine has finished. An edit during triage or during
   refine itself is recorded in `body_hash` and nothing else.
2. **After refine, it never fires in practice.** `refineFinished` matches only steps whose
   `skill === "refine"`, but every workflow names the skill `norn-refine` (`spec.yaml:16`,
   `story.yaml:17`, the bundled `story.yaml:17`). So `refined_body_hash` is never recorded and
   `bodyChangedItem` never returns an item. Tests pass because the core fixture uses `skill: "refine"`.

## Wanted

When the issue body changes after intake, the person and the agent working on the story find
out before more work builds on the old text:
- before refine finishes: the running agent sees it (e.g. in `norn brief`, or a nudge saying
  "the issue body changed since intake: re-read `gh issue view N`"), and/or an inbox item;
- after refine: the GR8 inbox item actually appears, for any workflow whose refine step uses the
  bundled skill.

Whether story.md's body should be updated before refine is the spec's call. GR8 says never
overwrite, but before refine story.md is still only a mirror.

## Repro

1. An issue is taken in (story.md mirrors its body), and its story starts a workflow.
2. Edit the issue body on GitHub.
3. `norn sync` → story.md's `body_hash` changes, its body does not, no inbox item; `norn brief` for
   the running step shows the old body.
4. Let a `spec`/`story` run pass `refine`, then edit the body again → still no
   "issue body changed since refine" item.

## Where

- `packages/core/src/decide/story.ts:150-163`: records `refined_body_hash` only when `refineFinished`
- `packages/core/src/decide/story.ts:167-173`: `refineFinished` matches `step.skill === "refine"`
- `packages/core/src/decide/story.ts:186-210`: `mirror` updates `body_hash`, `notify` only through `bodyChangedItem`
- `packages/core/src/inbox/items.ts:552-567`: `bodyChangedItem` needs `refined_body_hash`
- `packages/core/test/fixtures.ts:51`: fixture uses `skill: "refine"`, so tests miss gap 2
- `.agents/norn/workflows/spec.yaml:16`, `.agents/norn/workflows/story.yaml:17`, `packages/cli/assets/workflows/story.yaml:17`: `skill: norn-refine`

## PRD

GR8 (body change after refine → inbox item; spec body never overwritten), GR2 (intake mirrors the body).
