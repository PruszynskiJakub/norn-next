---
id: gh-110/03
title: Repo config at .agents/norn.config.yaml, workflows in .agents/workflows/
depends_on: [ gh-110/01 ]
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: agent }
---

## Goal
The committed half of the new layout: `norn init` writes the repo config to `.agents/norn.config.yaml` and the workflows to `.agents/workflows/`, and every command reads them there and names them there.

## Scope
Behaviour: B1, B2, B4. Seams: S1. Out: machine-local files (slice 04); refusing the old layout (slice 05); docs (slice 07).

## Acceptance
- AC1 (B1) Given a fresh repo, when `norn init` runs, then `.agents/norn.config.yaml` exists and no repo config or workflow is written under `.agents/norn/`; `norn config` shows repo settings as coming from `.agents/norn.config.yaml`. — verifier: test
- AC2 (B2) Given a fresh repo, when `norn init` runs, then `.agents/workflows/story.yaml`, `slice.yaml` and `bug.yaml` exist, and init's next steps name `.agents/workflows/`. — verifier: test
- AC3 (B2) Given `.agents/workflows/quick.yaml`, when a story labelled `norn:wf:quick` is taken in, then it runs that workflow; `norn story create --workflow nope` refuses `unknown_workflow` naming `.agents/workflows/`. — verifier: test
- AC4 (B4) Given gh-7 running on `story`, when `.agents/workflows/story.yaml` changes on the base, then gh-7 keeps its pinned copy and a story started afterwards pins the new one (S7). — verifier: test
- AC5 (B1, B2) Every refusal, hint and `do_instead` that names the repo config or workflows (`config`, `config edit`, `story create`/`edit`, adapter errors) names the new paths (D11). — verifier: test
- AC6 (B1, B2) In a throwaway repo, `norn init`, `norn config` and `norn config edit --repo` show and open the new files. — verifier: agent

## Checks
- `bun test packages/cli`
- `bun test packages/store`
- `bun run typecheck`

## Notes
D1, D8, D11. After slice 01 this is a change in store's path functions plus init and message texts. Transcripts and observe snapshots are expected not to change; review any change as a layout change, never rewrite blindly.
