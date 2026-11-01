# AC7 (B19)
`NORN_TRANSCRIPT_UPDATE=1 bun run test:e2e test/e2e/base-sync.test.ts`: exit 0, 12 pass. mtime changed only on test/e2e/transcripts/base-sync.txt (20:53:30); the other two transcripts untouched; `git status` clean afterwards → rewritten byte-identical. The recorder writes only when the variable is 1 (transcript.ts:263).
