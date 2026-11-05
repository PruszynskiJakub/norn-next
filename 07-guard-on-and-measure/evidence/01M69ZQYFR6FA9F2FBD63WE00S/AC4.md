# AC4 (B1, B3) — person
Agent run on this machine: Apple M2 Max, 12 cores, bun 1.3.13 (likely the maintainer's Mac, but a person confirms the clean checkout):
- `time bun run test`, three runs: real 1.93 s / 1.95 s / 1.89 s, 983 pass, 0 fail each (AC7-unit-{1,2,3}.log).
- Files in the run (junit, AC4-unit-files.txt): 55, all under packages/*/test/unit/ or test/repo/. No integration, e2e or harness file.
How to check: in a clean checkout of the branch, run `bun install && for i in 1 2 3; do time bun run test; done`. Expect about 983 pass, 0 fail and under 30 s each. `bun test --reporter=junit --reporter-outfile=/tmp/u.xml` and the testsuite names should all be unit/ or test/repo/.
