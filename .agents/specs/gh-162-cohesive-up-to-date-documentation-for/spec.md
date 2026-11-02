---
id: gh-162
slug: cohesive-up-to-date-documentation-for
provider: gh
number: 162
url: https://github.com/PruszynskiJakub/norn-next/issues/162
title: Cohesive, up-to-date documentation for newcomers
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:refinement
workflow: refinement
status: active
intake_at: 2026-11-02T08:57:16.094Z
body_hash: a8eafb25c7047dd6d22d5ba7d362414674429b7a1a6c33750728419341d752f8
---

## Observed

norn's docs grew one story at a time and are now spread across many files, with no single path a newcomer can follow:

- `README.md` (253 lines) is the pitch, install, quick start, concepts, config, plugins, architecture, all commands and contributing, all in one page.
- `.agents/PRD.md` (545 lines) is the spec. It still points to four separate `SPEC-*.md` files (`SPEC-cockpit`, `SPEC-herdr-cockpit`, `SPEC-base-sync-and-qa`, `SPEC-auto-mode-recovery`) for rules such as HC1–HC16, CP2, BS0–BS10 and QV1–QV8, even though AGENTS.md says never to add a new `SPEC-*.md`.
- `.agents/LIMITATIONS.md` says "as of release 0.5.0". The current release is 0.17.0.
- `CONTRIBUTING.md`, `AGENTS.md`, `plugins/herdr/README.md`, `docs/cookbook.html` and the audit folders under `docs/` overlap in places, and no doc says which one to read first.
- `handoff.md` is tracked at the repo root.

## Wanted

A newcomer, whether a person trying norn or a contributor, finds one obvious path through docs that are current, consistent and easy to follow:

- A short README that gets someone from zero to a first story, with links out to everything else.
- One place for concepts and the glossary, one for commands and config, and one for contributing (person side) and agents (agent side). Nothing is said twice.
- One PRD with the `SPEC-*.md` rules folded in. Cited ids stay stable, or every reference in code is updated with them.
- LIMITATIONS updated to the current release, or merged elsewhere.
- A decision on what happens to `docs/audit-*`, `docs/cookbook.html` and the root `handoff.md`: keep, move or remove.
- Every command, flag and output example checked against the current CLI.

Refinement settles the target structure, the audience of each doc and how the docs are kept current (for example, a repo test that catches stale versions or dead links).

## Where

- `README.md`, `CONTRIBUTING.md`, `AGENTS.md`
- `.agents/PRD.md`, `.agents/SPEC-*.md`, `.agents/LIMITATIONS.md`
- `docs/`, `plugins/herdr/README.md`, `handoff.md`
- `test/repo/repo.test.ts` (glossary lint over the docs)

## PRD

It touches the whole PRD as a document (§5 Glossary, §15, §17 and the SPEC-* ids HC*, CP*, BS*, QV*, NT*, R*). It is not meant to change behaviour.
