# gh-76 reproduce evidence
- tick-durations.jsonl: every tick in the live trace (main checkout, .agents/norn/trace/2026-10-28.jsonl) as {at, ms, renews}.
  Avg tick ms by renewals in that tick: 0→3740 (1082 ticks), 1→11173, 2→6918, 5→14524, 10→35655 (70 ticks), 14→44686.
- debug-gh76.test.ts: the loop. Copy to packages/cli/test/ and run `GH76_N=3 bun test packages/cli/test/debug-gh76.test.ts`.
- loop-red-N3.txt: its red output (3 renewals → 3 claim pushes, no other network call in the tick).
- git-batched-push-probe.txt: git accepts N leases in one non-atomic --porcelain push; a stale ref prints `!  … [rejected] (stale info)`, the others `+ … (forced update)`, exit 1.
