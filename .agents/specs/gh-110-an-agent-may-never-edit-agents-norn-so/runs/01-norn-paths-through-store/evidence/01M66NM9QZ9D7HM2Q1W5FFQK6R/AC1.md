# AC1 — full suite green, transcripts/snapshots/golden unchanged
- `bun run test:fast`: 948 pass, 0 fail (51.7s) — AC1-fast.txt
- `bun run test:cli`: 475 pass, 0 fail (587s) — AC1-cli.txt
- total 1423 = the full `bun test` set; `bun run typecheck` exit 0 — AC1-typecheck.txt
- `git diff base...HEAD -- packages/cli/test/transcripts packages/cli/test/observe-snapshots packages/core/test/golden` is empty; worktree clean after the runs (no snapshot rewritten).
