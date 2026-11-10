---
id: gh-317/05
title: norn stops looking for the old layout
depends_on: [ gh-317/02 ]
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
---

## Goal
No command checks for, mentions or moves the pre-0.13 layout: a repo holding only `.agents/norn/config.yaml` is a repo with no team file, stopped by the missing-version refusal, and doctor has no layout section.

## Scope
User stories: doctor shows no layout section and no old layout or `norn migrate`; a pre-0.13 repo read as having no team file, nothing moved. Seams: S1. Out: upgrade's use of the layout and `norn migrate` (03), doctor's run-state section (06).

## Acceptance
- AC1 Given a repo holding only the pre-0.13 files (`.agents/norn/config.yaml` and its kin), when an acting command runs, then it exits 3 with `version_missing` (not an old-layout refusal), and every old file is still where it was, unchanged. — verifier: test
- AC2 Given such a repo, when an agent hook fires, then it does not refuse on the layout. — verifier: test
- AC3 Given any repo, when `norn doctor` runs (markdown and `--json`), then there is no layout section or key, and no line mentions an old layout or `norn migrate`. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
D9 (layout part), D10: the store's old-layout module, `repoLayout`/`layoutProblems`, the `OLD_*` paths and the old tick lock path, the cli layout guard, `Command.layout` and `ctx.checksLayout`, the hook's layout check, doctor's early return that reported only the layout; `layout-guard.test.ts` and `toOldLayout` go with their last user. Depends on 02 because the refusal that now stops a pre-0.13 repo is 02's. Upgrade (03) also imports the layout; whichever of 03 and 05 lands second removes the last import at merge.
