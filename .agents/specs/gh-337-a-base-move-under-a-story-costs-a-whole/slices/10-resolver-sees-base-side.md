---
id: gh-337/10
title: The resolver sees the base side of each conflict
depends_on: [ gh-337/01 ]
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: agent }
---

## Goal
A resolving agent's brief lists, for each conflicting path, the base commits that touched it, the story that landed them, and where that story's spec and PR body are, so it resolves by both sides' intent.

## Scope
User stories: the `base_side` step input; the brief lists it and norn-merge reads it first; trailer-less base commits listed without a story; shipped resolve takes `base_side`. Seams: S2, S3. Out: asking instead of aborting (14).

## Acceptance
- AC1 Given a story with a merge in progress whose conflicting paths were touched on the base, when `norn brief` runs for a step with input `base_side`, then the brief lists per conflicting path each base commit between the merge base and the base sha that touched it: sha, subject, the story key from its `Norn-Story` trailer (a squash commit's last trailer block included), and that story's `spec.md` and `pr.md` paths on the base. — verifier: test
- AC2 Given a conflicting base commit with no story trailer, then it is listed with its subject and no story. — verifier: test
- AC3 Given the brief's base-update section, then it shows that base side. — verifier: test
- AC4 Given the shipped story and quick workflows (both copies), then `resolve` takes `base_side` in its inputs and validates. — verifier: test
- AC5 The bundled `norn-merge` skill tells the resolver to read the base side first. — verifier: agent

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run docs:emit`

## Notes
D10 (`base_side`, computed by the cli at `norn brief`). Edit the skill in its bundled copy only. The light-path slice (07) also adds commits-per-path to the git port; whichever lands second reuses it.
