## Summary

A program that reads norn through a pipe (`norn … --json | jq`, a script, an agent's shell tool) now gets the whole value even when it is over 64 KiB; before, everything after the first 64 KiB pipe buffer was dropped and the exit code still said success (P8).

```diff
 result = await runCli(argv)
-stderr.write(result.stderr)
-stdout.write(result.stdout)
+await stderr.write(result.stderr) flushed   // write callback
+await stdout.write(result.stdout) flushed
 process.exit(result.exit)
```

## Evidence

- **Wanted** the whole value through a pipe, so `--json` output parses (P8)
  **Before:** `bun packages/cli/src/main.ts <100 kB unknown command> --json | wc -c` gave `65536` (to a file: `100237`).
  **After:** the same pipe gives `100237`; 300 kB through `| wc -c` and through a slow reader (`| (sleep 1; wc -c)`) also arrive whole (checked by hand in implement and again in review).
  Test `packages/cli/test/integration/stdout-pipe.test.ts`: `sh -c 'bun main.ts <100 kB name> --json | cat'` → output longer than 65 536 bytes and `JSON.parse` gives a `CliError` naming the command. Red before the fix, green now. It runs `main.ts` from source rather than the built binary the issue named; the bundle wraps the same entry code.
- **Wanted** file and TTY stdout unchanged
  **Before:** whole.
  **After:** same write path, only awaited; the existing cli tests pass. Not checked separately on a TTY.
- **Where** `watch` and the signal path
  **After:** `watch` returns through the same flushed path (by reading). The second-signal hard stop (`process.exit(130)`) writes nothing, so it was left as is. A reader that closes early (`| head -c 10`) does not hang the exit (checked in review).

## Merge danger

**Door:** two-way: a revert of the six lines in `main.ts` restores the old exit.

**Blast radius:** low: every command exits through this path; the worst case is an exit that waits on a stalled reader, which review checked does not happen when the reader closes early.
