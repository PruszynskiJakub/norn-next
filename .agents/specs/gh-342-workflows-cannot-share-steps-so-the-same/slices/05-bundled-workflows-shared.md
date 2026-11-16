---
id: gh-342/05
title: Bundled workflows rewritten with shared files, and `norn init` copies them
depends_on: [ gh-342/01, gh-342/04 ]
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
---

## Goal
The shipped `quick` and `story` take their sync, base update and shipping steps from bundled shared files, with the CI wait written once, and load to exactly today's workflows; `norn init` copies the bundled `shared/` folder so they load in a new repo.

## Scope
User stories: bundled `quick`/`story` rewritten with shared files load to today's workflows; `norn init` copies `shared/`, keeping existing shared files. Seams: S3. Out: this repo's own set (06), the recipes (08).

## Acceptance
- AC1 Given the rewritten bundled templates with their `shared/` files, when the asset tests load them through the store's loader, then `quick` and `story` equal the `workflowHash` recorded by slice 01 (29 routes / 8 counters and 42 routes / 10 counters), the CI wait (`gh pr checks --watch`) appears in exactly one bundled file, and YAML anchors are gone in favour of `like:`. — verifier: test
- AC2 Given the rewrite, when the golden cases and transcripts run, then none of them changes. — verifier: test
- AC3 Given a new repo, when `norn init` runs, then every bundled `shared/` file is copied to `.agents/workflows/shared/` and reported as `shared/<file>` under created, and a shared file the repo already has is kept and reported under kept; afterwards every bundled workflow loads without errors. — verifier: test
- AC4 Given a repo whose build files name a test command, when `norn init` runs, then that command is written into the shared file that holds the test check, and the loaded workflows' test check runs it. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run docs:emit`

## Notes
Plan D10: follow the prototype's split (sync, base update, shipping); the recorded hash decides what is shared, a split that changes it is wrong. Plan D9 for init (copy each missing `shared/` file; `withTestCommand` applies to every copied file). The asset test that lists the shipped workflow files must skip the `shared/` folder. AC3 and AC4 are integration tests (init-version / init-review style), which CI runs. Depends on 04 because anchors give way to `like:`, and on 01 for the recorded hashes.
