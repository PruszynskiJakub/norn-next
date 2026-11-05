# AC8 (B22) — unverified
No PR exists yet, and this step may not create or edit one. Numbers measured on this branch, for the PR body:

| Measure | Value |
|---|---|
| Baseline cli tests | 702 s |
| Baseline full serial | 630 s |
| Unit tier (`bun run test`) | 1.9 s (983 tests; 3 runs 1.89–1.95 s) |
| `test` check (`bun run test && bun run test:integration && bun run typecheck`) | 117 s (AC8-test-check.log) |
| Integration alone | 110–112 s (505 tests) |
| e2e alone | 79–80 s (72 tests) |
| CI push-to-green | not measurable: no PR/CI run yet |

Machine: Apple M2 Max, 12 cores, bun 1.3.13.
How to check: after the story PR opens and CI goes green, add the CI wall clock (`gh run view <id> --json createdAt,updatedAt`) to this table in the PR body, and check the body has the table.
