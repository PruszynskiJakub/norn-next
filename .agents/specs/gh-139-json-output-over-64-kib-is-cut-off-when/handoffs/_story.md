## Goal

stdout carries the whole value through a pipe, past the 64 KiB pipe buffer, so `--json` output always parses (P8).

## Progress

- Reproduced: `bun packages/cli/src/main.ts <100 kB unknown command> --json | wc -c` gave 65536; to a file, 100237.
- Red test: `packages/cli/test/integration/stdout-pipe.test.ts` pipes a >64 KiB refusal through `sh -c '… | cat'` and parses it. Bun.spawn's own stdout pipe does not show the cut (the test passed before the fix that way), so the test uses a shell pipe like `norn … | jq`.
- Fix: `packages/cli/src/main.ts` awaits each write's callback (stderr, then stdout) before `process.exit`. `watch` returns through the same path, so it is covered. The second-signal hard stop (`process.exit(130)`) writes nothing, so it was left as is.
- Checked by hand: 300 kB through `| wc -c` and through a slow reader (`| (sleep 1; wc -c)`) arrive whole.
- Unit tier and typecheck green.
- implement#1 done: main.ts now waits for stderr/stdout writes to flush before process.exit (P8), so piped output over 64 KiB arrives whole; integration test stdout-pipe.test.ts pipes a 100 kB refusal through a shell pipe and parses it (red before: 65536 bytes). Unit tier + typecheck green.
- implement#2 (rework after test.fail): the one failing test was `check-run.test.ts` "two long checks (K1, K3)", which wants the tick's `duration_ms` under 2500 and got 3622 in the parallel integration run. That figure is measured inside the tick (`runtime/tick.ts`), before main.ts writes anything, so this change cannot move it; the file passed 3/3 run alone. A timing flake under load, not a regression. No code change. Friction: that wall-clock bound is flaky under `--parallel` and worth its own issue.
- implement#2 done: Rework: the one failing test (check-run.test.ts K1/K3, tick duration_ms 3622 against a 2500 bound) is a timing flake under the parallel integration load. duration_ms is measured inside the tick before main.ts writes anything, so the gh-139 change cannot move it, and the file passed 3/3 run alone. No code change; unit tier and typecheck green.

- review#1: approve. Verified by hand: old main.ts piped through `wc -c` gives 65536, new gives 100237; the new test passes; a reader that closes early (`| head -c 10`) does not hang the exit. No blocking findings; one nit (the test runs main.ts from source, not the built binary the issue named; same code path).

| Item | Verifier | Proven by |
| --- | --- | --- |
| Wanted: whole value through a pipe, `--json` parses (P8) | test | `packages/cli/test/integration/stdout-pipe.test.ts` › "a refusal over 64 KiB reaches the reader complete and parses" |
| Wanted: file / TTY stdout unchanged | test | existing cli tests (stdout to file/pipe in harness); unchanged path |
| Where: `watch` and signal path exit the same way | review (by reading) | `watch` returns through the same flushed path in main.ts; the second-signal hard stop writes nothing (no output to lose) |
- review#1 approve: Approve: main.ts waits for stderr/stdout write callbacks before exit; verified old 65536 vs new 100237 bytes through a pipe, early-closing reader does not hang; stdout-pipe.test.ts proves it. One nit (test runs source, not built binary).

## Resume

Review approved; next is whatever norn routes after review (no action for this step).
