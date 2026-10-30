# AC1 — removed-commands lint
- `bun test test/repo.test.ts` on the tree as shipped: 26 pass, 0 fail.
- Planted, one at a time (each restored after; `git status` clean):
  - CONTRIBUTING.md: "Run `norn unstick gh-1` to recover." → fail: `CONTRIBUTING.md:80 → norn unstick was removed (B5)`
  - plugins/herdr/next.sh: `"$NORN" drop gh-1` → fail: `"$NORN" drop was removed (B5)`
  - packages/cli/assets/skills/norn/SKILL.md: "Use `norn status gh-1` and `norn cockpit --next`." → fail with 3 hits: `norn cockpit`, `norn status gh-1`, `cockpit --next`
  - .agents/PRD.md: same line → fail with the same 3 hits.
- Full suite: 1380 pass, 0 fail; typecheck clean (suite.txt).
