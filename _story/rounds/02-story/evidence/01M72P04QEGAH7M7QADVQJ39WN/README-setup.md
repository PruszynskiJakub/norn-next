# How this evidence was made (QA #6, HEAD 67c548055)
- Dev build `bun packages/cli/src/main.ts` (0.30.0) via wrappers that unset the session's NORN_*/HERDR_* env and set NORN_HOME_DIR to a throwaway machine dir (`lib.sh` holds the helpers).
- "Newer norn": an rsync copy of the worktree with packages/cli/package.json at 0.31.0 and the bundled norn-qa skill given one extra line (`QA-MARKER 0.31`).
- Fixtures: a `norn init`ed base repo (0.30.0) copied per case with `norn_version` edited (0.29.4, removed, 0.30.0, 0.31.0); a pre-0.13 repo with only `.agents/norn/*`; view's gh-1 fixture (an older norn's spec folder with runs/) for base-tree run state.
- Remote label calls: stub `gh` on PATH (`stubs/gh-labels-ok` lists only `norn`; `stubs/gh-down` fails). 06.AC1: bare local remote, stub gh serving issue #1 (`stubs/gh`), stub claude, PATH without herdr.
- Tick lock: `hold.ts` holds it through store's acquireTickLock. Baseline rule: `rule.ts` calls @norn/core's versionBaseline.
- "repo+machine-dir changed" compares git status, HEAD, staged diff, every file's hash and the machine dir's file list before and after each command.
- All throwaway repos live under $TMPDIR/qa6-gh317 (removed after the report).
