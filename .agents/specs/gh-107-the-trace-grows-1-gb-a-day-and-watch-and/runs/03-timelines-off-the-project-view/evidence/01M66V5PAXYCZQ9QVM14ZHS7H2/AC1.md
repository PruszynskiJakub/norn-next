# AC1 (B1) — cockpit reads no trace day file

Setup: throwaway repo from `bun scripts/trace-bench.ts --gb 0.02 --days 16 --hooks 50 --keep` (16 day files, ~21 MB, one story gh-1 with a run).
Today's day file (the one holding the live run's hook lines; read by local facts' hook read until slice 04, B8) moved away, so 15 older day files remain.
Observer: `/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa-gh107-03/observed-norn.ts` installs store's `setTraceReadObserver` and runs `packages/cli/src/main.ts`, printing `TRACE-READ <file>` on stderr for every day file opened.

| command | this branch | base (e83f5f1e) |
|---|---|---|
| `norn cockpit --json` | 0 day files | 14 |
| `norn cockpit --interval 500ms` for 3 s (3 frames) | 0 | 28 opens (14 distinct) |

`cockpit --json` prints the same output (`AC-full-cockpit_--json.json` = `AC-empty-cockpit_--json.json`) with every day file moved away.

Suite: `packages/cli/test/trace-free-views.test.ts` "norn cockpit --json and a refreshing cockpit open no day file (B1)" passes (see suite.txt).
