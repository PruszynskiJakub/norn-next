# AC5 (B18) — hook quiet; brief/done/ask/stuck refuse
Old layout: `norn hook </dev/null` and both layout `norn hook stop </dev/null` → `{}` exit 0; no file changed (sha snapshot). `brief --json`, `done pass --json`, `ask q --json`, `stuck r --json` → exit 3, old_layout, do_instead norn migrate.
Hook with a real Stop/PreToolUse payload inside a unit worktree (records nothing, blocks nothing): layout-guard.test.ts "norn hook exits 0, records nothing and blocks nothing" — pass.
Evidence: AC1-AC3-AC5-old.txt, AC2-AC4-both.txt, layout-guard-test.log.
