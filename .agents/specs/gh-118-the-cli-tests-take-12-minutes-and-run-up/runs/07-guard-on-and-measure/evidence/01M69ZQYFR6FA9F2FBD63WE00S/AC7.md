# AC7 (B20) — unverified (local part observed green)
Local, three runs in a row each, in sequence on an idle machine (AC7-summary.txt and the logs):
- `bun run test`: 983 pass / 0 fail ×3 (1.93, 1.95, 1.89 s)
- `bun run test:integration`: 505 pass / 0 fail ×3 (112.1, 111.7, 110.4 s)
- `bun run test:e2e`: 72 pass / 0 fail ×3 (79.6, 79.5, 79.4 s)
- `bun run typecheck`: exit 0
CI: **no PR exists** for gh-118 (`gh pr list --head gh-118-the-cli-tests-take-12-minutes-and-run-up --state all` → []). This slice step may not open one (only norn pushes). The CI half cannot be observed yet.
How to check: once norn opens the story PR, run `gh pr checks <N>` and expect unit+typecheck, integration, the 3 e2e shards and package all green.
Flake note: one extra e2e run I started *while integration ran at the same time* (AC5-head-e2e.log) failed `recovery.test.ts` "renewals due together go out in one push (H5, R1.2)" with a hook timeout and "not inside a git repository". The same test also failed in the base copy's `test:cli --parallel` run (AC5-base-cli.log). It is a pre-existing load-sensitive flake, not part of the three sequential runs.
