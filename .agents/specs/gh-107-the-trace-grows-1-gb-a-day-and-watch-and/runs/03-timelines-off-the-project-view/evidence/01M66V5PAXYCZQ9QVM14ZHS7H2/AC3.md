# AC3 (B3) — timelines unchanged, project view carries none

Repo: same bench repo with 16 day files (2026-10-15 lies outside the 14-day window) plus one broken tick line appended to 2026-10-25.jsonl.
Base tree (e83f5f1e, the story branch before this slice): `git archive` into `/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa-gh107-03/base`, `bun install`.

- base: `loadProjectView({repoRoot, now}).timeline` → `AC3-base.json` (script ac3-base.ts)
- branch: `loadTimelines({repoRoot, now}).timeline` and `loadProjectView` → `AC3-new.json` (script ac3-new.ts)

Results (same `now`):
- `diff <(jq -S .timeline AC3-base.json) <(jq -S .timeline AC3-new.json)` → no difference. gh-1: 254 entries (252 wait, 1 started, 1 briefing), first at 2026-10-17T00:00Z (window honoured; 10-15/10-16 excluded).
- trace errors: base view 51, `loadTimelines` 51 (same files:lines, incl. the broken 2026-10-25 line).
- branch `loadProjectView`: `"timeline" in view` = false, `view.errors` = [] (no trace parse errors).
- `norn trace gh-1 --json` (loadTraceView, unchanged code) runs and reads day files as before.

Suite: packages/view/test/view.test.ts loadTimelines tests pass.
