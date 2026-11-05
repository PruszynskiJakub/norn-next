## Goal

stdout carries the whole value through a pipe, past the 64 KiB pipe buffer, so `--json` output always parses (P8).

## Progress

- Reproduced: `bun packages/cli/src/main.ts <100 kB unknown command> --json | wc -c` gave 65536; to a file, 100237.
- Red test: `packages/cli/test/integration/stdout-pipe.test.ts` pipes a >64 KiB refusal through `sh -c '… | cat'` and parses it. Bun.spawn's own stdout pipe does not show the cut (the test passed before the fix that way), so the test uses a shell pipe like `norn … | jq`.
- Fix: `packages/cli/src/main.ts` awaits each write's callback (stderr, then stdout) before `process.exit`. `watch` returns through the same path, so it is covered. The second-signal hard stop (`process.exit(130)`) writes nothing, so it was left as is.
- Checked by hand: 300 kB through `| wc -c` and through a slow reader (`| (sleep 1; wc -c)`) arrive whole.
- Unit tier and typecheck green.
- implement#1 done: main.ts now waits for stderr/stdout writes to flush before process.exit (P8), so piped output over 64 KiB arrives whole; integration test stdout-pipe.test.ts pipes a 100 kB refusal through a shell pipe and parses it (red before: 65536 bytes). Unit tier + typecheck green.

## Resume

Nothing left in implement; the integration tier runs in the `test` check.
