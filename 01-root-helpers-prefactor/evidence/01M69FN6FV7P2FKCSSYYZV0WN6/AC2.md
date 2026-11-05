# AC2
- REPO_ROOT (packages/cli/test/repo-root.ts) finds the nearest workspaces package.json; TRANSCRIPTS_DIR and OBSERVE_SNAPSHOTS_DIR are joined from it (transcript.ts, observe-snapshot.ts); pinned-outputs.test.ts pins both.
- Golden: scripts/golden.ts names its corpus as join(ROOT,"packages","core","test","golden") with ROOT = repo root; golden-harvest.ts writes only to NORN_GOLDEN_OUT, which golden.ts sets under its own temp dir. No change needed.
- Full suite in this worktree on HEAD: `bun install --frozen-lockfile` ok, typecheck ok, `bun test` 1533 pass / 0 fail (606.7 s), `git status --porcelain` empty before and after, `git diff --exit-code -- transcripts observe-snapshots core/test/golden` exit 0. Log: full-suite.log.
- AC3.md negative control shows the transcript helper writes to the real pinned folder (a hand-edited base-sync.txt was rewritten back to HEAD).
