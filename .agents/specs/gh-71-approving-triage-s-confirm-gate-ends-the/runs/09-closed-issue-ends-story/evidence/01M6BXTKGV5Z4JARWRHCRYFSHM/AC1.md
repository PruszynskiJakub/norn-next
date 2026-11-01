# AC1 (B22) — decide emits close_story only when it should
- `bun run test`: 1022 pass, 0 fail (tests.txt). Covers decide.test.ts:
  - "B22 (GR6b): a closed issue on a finished round with no PR and no unfinished slice closes the story" — positive, incl. an older norn's remote park at $done, integrated/dropped slices, mailbox refs carried.
  - "B22 (GR6b): no close on an unseen or unobserved issue, an open PR, an unfinished slice or an unfinished round" — issue null/undefined, open PR, PR undefined, planned/active slice, unfinished round.
  - rule case "the issue closed on a finished round with no PR" (rule-cases.ts) for remote.issue_closed; golden coverage test green.
- Observed at the CLI too (AC5-sync.txt): the real build's sync decided `remote.issue_closed close_story` on exactly that situation.
