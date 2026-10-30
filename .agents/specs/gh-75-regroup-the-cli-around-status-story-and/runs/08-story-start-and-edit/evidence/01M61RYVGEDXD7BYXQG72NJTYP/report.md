# QA gh-75/08 — story start and story edit

Full suite: 1252 pass, 0 fail; typecheck green (suite.txt). Manual checks in a throwaway repo (fake `gh` on PATH, NORN_HOME_DIR isolated, headless runner with a stub `claude`), using `bun packages/cli/src/main.ts`.

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| AC1 (B28) | pass | AC1.md | --print and no-runner print the command; no-target lists only startable units (gh-9 running excluded). Real Herdr tab not opened here (fake Herdr test covers it) |
| AC2 (B30) | pass | AC2.md | tick launched gh-9 in auto after --auto; usage errors exit 2 |
| AC3 (B31) | pass | AC3.md | frontmatter workflow set before start |
| AC4 (B32) | pass | AC4.md | needs_to names --at; receipt journaled and applied |
| AC5 (B55) | pass | AC5.md | mode → story, --workflow → slice from slice worktree |
| AC6 (B5) | pass | AC6.md | Unknown command, exit 2 |
| AC7 (B28, B32) | pass | AC7.md, AC4.md | pasted command ran in the worktree (stub claude ran norn brief) |

Observations (not failures): story start/edit print JSON without --json (as open/mode/workflow did); the TTY picker could not be driven under `script` here (it saw no terminal), so the picker filtering was observed through the target_required do_instead list; init's config.yaml comments and inbox hints still name `norn open`/`norn mode` (slice 14).
