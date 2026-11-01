# AC1: existing tiers pass unchanged; transcripts and golden unchanged
- `bun run test`: 987 pass, 0 fail (AC1-quick.txt)
- `bun run typecheck`: clean (AC1-quick.txt)
- `bun run test:integration` (includes story-reopen.test.ts and the story close tests): 511 pass, 0 fail (AC1-integration.txt)
- `bun run test:e2e` (transcripts, observe snapshots): 72 pass, 0 fail (AC1-e2e.txt)
- `git status` clean after every tier, so no transcript or snapshot was rewritten. `git diff base...HEAD --stat` touches only story-close.ts, runtime/close.ts and runs/ (no test, transcript or golden file).
