# How this evidence was made
- Dev build: `bun packages/cli/src/main.ts` (0.30.0) via a wrapper that unsets the session's NORN_*/HERDR_* env and sets NORN_HOME_DIR to a throwaway machine dir.
- "Newer norn": an rsync copy of the worktree with packages/cli/package.json version 0.31.0 and one bundled skill (norn-qa) changed.
- Fixture repos: a `norn init`ed base repo copied per case, `norn_version` edited (0.29.4, removed, 0.30.0, 0.31.0); a pre-0.13 repo with only `.agents/norn/*`.
- Remote label calls: a stub `gh` on PATH (one that lists only `norn`, one that fails); 06.AC1 used a bare local remote, stub `gh` serving issue #1 and a stub `claude`.
- "repo+machine-dir changed" lines compare `git status`, HEAD and the machine dir's file list before and after each command.
