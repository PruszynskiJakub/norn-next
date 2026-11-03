## Summary

The brief of a step that follows a check now lists the checks that ran since the last report (step, command, outcome, duration, pointer to the log). A reviewer can see that, for example, e2e has not run yet. Before this, the brief showed a check only when it failed, under Rework.

```diff
 renderBrief
   rework            (the failing check that sent the work back)
+  checksSince       (check receipts after the unit's last `done` receipt,
+                     the one under Rework left out; null when none)
   rulings
   context
```

What a review step after `test` now sees:

```markdown
## Checks since the last report

These checks ran on the code since implement#1 reported; nothing else has run on it yet.

- test#1 `pass` in 1m 23s — `bun test` — output: `…/runs/02-form/receipts/0003-check.json`
```

`--json` carries the same list as `checks: { since, items[] }`. The log pointer is the full log when the check kept one (a failing check), otherwise the check's receipt, which holds the output tail. The B3 table in `.agents/RULES.md` gets the new row.

**Diverges from the issue:** the issue asks for checks "since the last implement". The window starts at the last `done` report from any step, because core cannot tell which step is the implement step. Every shipped workflow step that runs right after a check sees that check (review or qa after `test`, implement after `ci`). A step that comes after a report that changed no code sees no list. For example, this describe step comes after review approved, so its brief had no section. Review flagged this as minor and non-blocking (F1).

## Evidence

No QA ran (`quick` workflow). Unit tests in `packages/core/test/unit/brief.test.ts`, "Checks since the last report (B3, gh-170)", cover the behaviour. The section did not exist before this change. All three tests pass now, along with the rest of the unit tier (1106 tests) and the typecheck.

- **Lists the checks after a check: step, command, outcome, duration, log pointer**
  **Before:** did not exist. A passing check did not appear in the brief.
  **After:** `implement done → test pass → review`: `json.checks == { since: "implement#1", items: [{ step: "test", attempt: 1, command: "bun test", outcome: "pass", duration_ms: 83400, log: "…/receipts/0003-check.json" }] }`. The markdown section is pinned by a snapshot.
- **Only checks since the last report; no duplicate of Rework**
  **Before:** did not exist.
  **After:** with three implement → check rounds, review lists only the last `pass`. When implement is re-entered from a failing check, `checks` is `null` because that check is already under Rework.
- **No check since the last report: no section**
  **After:** `test pass → review approve → qa`: `checks == null`, and the markdown has no `## Checks` section.
- **A reviewer actually says "e2e has not run yet"**: not shown. This depends on an agent reading the brief. To check it, run a `story` round in this repo and read the review step's brief: it should list only the `test` check, which runs no e2e.

## Merge danger

**Door:** two-way: the change adds a section to the brief and a new `checks` field (null when empty) to `brief --json`. No persisted format changes. A revert removes both.

**Blast radius:** agents' briefs: each step after a check gets a few more lines. A wrong list could mislead a reviewer about what ran, but it changes no decision. `decide` does not read the brief.
