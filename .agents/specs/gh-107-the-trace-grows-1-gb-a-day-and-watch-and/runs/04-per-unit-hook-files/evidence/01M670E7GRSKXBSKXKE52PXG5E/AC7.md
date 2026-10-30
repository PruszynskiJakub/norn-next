# AC7 (B10, agent): pass
`bun bench/scripts/trace-bench.ts --gb 2 --cockpit 5s --interval 2s --status-runs 3 --norn "bun <worktree>/packages/cli/src/main.ts" --keep` (AC7-bench.json):
- trace 2,152,125,250 bytes in 14 day files, 420 hook facts for the live run;
- `norn brief --json` in the live unit's worktree, 5 runs: full trace 333/335/**342**/342/351 ms; empty trace (day files moved away) 367/370/**455**/545/619 ms. Ratio of the medians 0.75: about the same time.
- The same output also has status ×4.2 and cockpit peak RSS ×24 over the full trace. Those are 03's (B1/B2), and 03 is not merged into this branch; they are not this criterion.
