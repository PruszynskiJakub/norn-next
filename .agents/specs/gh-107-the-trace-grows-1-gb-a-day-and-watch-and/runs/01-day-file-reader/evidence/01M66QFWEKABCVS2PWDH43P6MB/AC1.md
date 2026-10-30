# AC1 (B4) — `norn trace <unit>` prints the same events as before
Test (verifier): `bun test packages/cli/test/agent-protocol.test.ts` → pass, incl. "B4: `norn trace` prints the same events with lines it does not show added…". Full suite: 1244 pass, 0 fail; typecheck clean (suite.txt).
Real interface: throwaway repo with 3 days (27–29 Oct, 23,499 lines, ~96 MB) of this repo's real trace + the gh-75 story records (story + 12 slices: ticks, hook events, step events).
`trace gh-75`, `trace gh-75/01`, `trace gh-75/03`, `trace gh-75/12` (markdown, --json, --all --json) with the branch build vs v0.11.1 (= slice base; no package changes between them):
- markdown: byte-identical for all 4 units;
- slice JSON (normal and --all): byte-identical;
- story JSON: identical except the open ready#2 gate's now-relative durations (duration_ms/wait_ms/ready/gate/human_wait_ms/wall_clock_ms), which differ between v0.11.1 and the base build in the same way (clock between runs). Identical once those fields are removed.
Files: AC4/{rel,base,branch}-trace-*.{md,json}
