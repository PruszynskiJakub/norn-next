---
id: gh-318/03
title: Worktrees move into the machine dir
depends_on: [ gh-318/01, gh-318/02 ]
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: test }
  - { id: AC7, verifier: test }
  - { id: AC8, verifier: test }
  - { id: AC9, verifier: test }
  - { id: AC10, verifier: test }
  - { id: AC11, verifier: agent }
---

## Goal
norn creates and finds every story and slice worktree in the checkout's machine dir, `<machine dir>/worktrees/`, and never creates or looks in a `<repo>-worktrees/` folder beside the repository; the docs say where worktrees live.

## Scope
User stories: story worktree from `norn sync` / `story start`; slice worktree beside it; no `<repo>-worktrees/` folder; worktrees follow a bound home; two clones never share a folder; `--print`, inbox start command, brief and Herdr tabs show the new path; `norn tidy` orphans in the new folder; the gone-check; the view; the docs. Seams: S1, S2. Out: compatibility with or migration of `<repo>-worktrees/`, moved repositories, doctor's adoption advice.

## Acceptance
- AC1 Given a repository with a story ready to start, when `norn sync` (or `norn story start`) creates its worktree, then it is at `<machine dir>/worktrees/<story>-<slug>` on the story's branch. — verifier: test
- AC2 Given a story with an approved slice, when the slice starts, then its worktree is at `<machine dir>/worktrees/<story>-<slug>--<nn>-<slug>`, beside the story's. — verifier: test
- AC3 Given any integration test, when the harness cleans up, then no `<repo>-worktrees` folder exists beside its repository. — verifier: test
- AC4 Given a norn home bound by `--home` or `NORN_HOME_DIR`, when a story worktree is created, then it sits under that home's machine dir for the checkout. — verifier: test
- AC5 Given two clones of one remote with the same story key started in each, when each creates the story's worktree, then each lands in its own clone's machine dir and the two paths differ. — verifier: test
- AC6 Given a started story, when a person runs `norn story start --print`, reads the inbox's start command or the brief, or the Herdr tab for the unit opens, then the path shown (the tab's working directory) is the worktree in the machine dir. — verifier: test
- AC7 Given a clean and a dirty norn-shaped worktree in the machine dir's `worktrees/` whose story is unknown here, when a person runs `norn tidy`, then both are reported as orphans and only the clean one is removed. — verifier: test
- AC8 Given a started story whose worktree folder was deleted from the machine dir's `worktrees/`, when a person runs `norn story start`, then norn notices it is gone and recreates or reports it rather than assuming it present. — verifier: test
- AC9 Given running story and slice units, when a person runs `norn status --json`, then each unit shows its worktree in the machine dir's `worktrees/`. — verifier: test
- AC10 Given the golden corpus with its recorded worktree paths and repo worktrees fact rewritten to the machine dir's `worktrees/`, when the golden replay runs, then no decision changes. — verifier: test
- AC11 Given the docs, when a person looks up where unit worktrees live (the run state paragraph and the glossary's worktree entry in the concepts page), then they read that worktrees live in the checkout's machine dir under `worktrees/`, and no doc mentions `<repo>-worktrees`. — verifier: agent

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
- The golden replay runs inside `bun run test`; rewrite the corpus by script, then `bun run golden -- --update` must print no changed case. Run `bun run docs:emit` if a generated doc names the path.
- D2: the folder is `<machine dir>/worktrees`; folder names unchanged; git creates the parents on `worktree add`. D3: recognition moves wholesale, nothing looks at the old folder. D4: the harness cleanup check. D5: pinned outputs (≈130 golden cases, four observe snapshots, three e2e transcripts) are rewritten mechanically in one commit and reviewed as paths only.
- macOS: the machine dir is under the home, so `/var` vs `/private/var` spelling can differ from `git worktree list`; prove the gone-check and orphan check on the real path first.
- A grep for `-worktrees` in the packages' sources must come back empty.
- Size: this is the largest slice (the move itself is one line, the rest is new integration tests and mechanical pinned-output rewrites). It is kept whole because the move and recognition must change together to stay green; if it does not fit one context, the tests for home, clones, tidy, gone-check and view could split into a follow-up slice depending on this one.
