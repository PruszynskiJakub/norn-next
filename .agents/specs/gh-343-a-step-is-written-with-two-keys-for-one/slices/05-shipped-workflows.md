---
id: gh-343/05
title: Shipped workflows, this repo's copies and the schema in the new wording
depends_on: [gh-343/04]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: person }
---

## Goal
`norn init` writes workflows and shared files in the new wording, each agent step with a hand-written orientation; this repo's own copies (with `release.yaml`) match; the emitted JSON Schema describes only the new wording.

## Scope
User stories: shipped workflows in the new wording with orientations; this repo's copies including `release.yaml`; emitted schema new wording only. Seams: S8. Out: docs prose (slice 10); refusing old files (slice 09).

## Acceptance
- AC1 Given `norn init` in a fresh repo, when it writes the workflows and shared files, then each loads in the new wording with no `type`, `skill`, `instructions`, `run`, `prompt`, `action` key or `means`/`verdict` inside an edge, and every agent step has an orientation. — verifier: test
- AC2 Given this repo's `.agents/workflows/` (with `shared/` and `release.yaml`), when loaded, then every file is in the new wording and the shared copies match the shipped ones. — verifier: test
- AC3 Given the emitted schemas, when the schema emit check runs, then the workflow-source and shared-file schemas describe one step shape per head key and accept none of the old keys, the model schema is no longer published as `workflow.schema.json`, and each shipped file's `$schema` reference points at the new-wording schema. — verifier: test
- AC4 Each agent step's hand-written orientation tells the agent what the step is for, in the spirit of the design record's `quick.yaml`, and the moved workflow hashes in the assets test were reviewed, not re-recorded blindly. — verifier: person, because whether an orientation steers an agent well is a judgement on prose.

## Checks
- `bun run schema:emit`
- `bun run docs:emit`
- `bun run test`
- `bun run typecheck`

## Notes
D7; risk "assets.test.ts pins workflowHash". Change each shipped workflow in both `packages/cli/assets/workflows/` and `.agents/workflows/`. Start from the translator's output, then hand-write the orientations where it used a fallback.
