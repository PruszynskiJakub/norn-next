# AC4 (B13), fresh checkout repo2
1. `status --json` first: no stderr, notices.json not created (not spent).
2. `status`: stderr = "`norn status` now shows what needs you; the story listing moved to `norn story list`."
3. `status` again: stderr empty; stdout identical to run 2 (cmp).
4. `status --json` before/after notice: identical.
5. notices.json = "garbage{": notice shown again, exit 0, file rewritten valid.
6. notices.json chmod 000: notice shown, exit 0.
Tests: status.test.ts (4 notice tests) pass.
