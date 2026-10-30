# AC8 — story approve / story reject --reason at the terminal vs the old commands
Script: throwaway harness repo (temp git repo + bare origin, fake gh remote, headless runner), workflow `gated` (work → review gate).
Two stories (gh-1, gh-2) driven to the review gate, then:
- branch: `norn story approve gh-2`, `norn story reject gh-1 --reason "misses B4"` → AC8-new.txt
- base 7ee9697 (git archive): `norn approve gh-2`, `norn approve gh-1 --reject --reason "misses B4"` → AC8-old.txt
Stdout + exit codes are identical apart from ulids/shas (diff empty). Receipts: approve (step review) and reject with comment "misses B4".
Next tick: gh-2 → $done/done; gh-1 → work attempt 2, loop counter 1 — the same on both.
Refusals (AC8-new-refusals.txt): `story reject gh-1` without --reason → exit 2, reason_required, do_instead "pass --reason …"; `approve`, `update` → exit 2 "Unknown command".
Limit: run through runCli with the harness's fakes (no real gh remote), not the installed binary.
