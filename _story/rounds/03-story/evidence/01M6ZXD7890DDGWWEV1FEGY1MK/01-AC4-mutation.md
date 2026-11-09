# 01.AC4 mutation check
Blanked the `no-run-state` reason in packages/core/src/hard-rules.ts (temporary, restored from a copy; `git status` clean after).
`bun test packages/core/test/unit/brief.test.ts -t reason`:
(fail) How to work gives every hard rule its reason > the run state, no-push and no-switch rules say what breaks
(fail) How to work gives every hard rule its reason > every hard rule comes from the one list, each with a non-empty reason after it
(plus the snapshot tests). The rules render from HARD_RULES via ruleWithReason (packages/core/src/brief.ts protocolLines) and the session note renders the same list (07-notes.md).
