---
name: norn-qa
description: Checks a change from the user's side by actually running it, giving each acceptance criterion one verdict with evidence in a criteria report. Use when asked to QA, verify or acceptance-test a change. Not for finding a bug's cause; use norn-diagnose. QA alongside a person is norn-qa-person.
---

# QA

Without this, an agent passes what the tests or the code suggest instead of what it saw. You check every criterion through the real interface and collect the evidence; a person may QA after you (`norn-qa-person`), and your pack is where they start. Evidence or it didn't happen.

## Check

1. **List the criteria.** When the slice or story frontmatter lists `criteria`, those ids are the list: one verdict for each, and for no other id. Otherwise take the Acceptance items (for a bug fix: the reported behaviour, which must no longer happen). Note each one's verifier and which ones are seen in a web page. A `person` verifier says why; that reason is what only a person checks.
2. **Prepare the environment** the way a user would: build, start the app or service, seed data, on the ports and environment configured for this worktree. Do not rerun the test suite: a separate check already ran it, and tests are not QA.
3. **Check every criterion that is not `person` as a user would**, `test` and `agent` verifiers alike, through the real interface (UI, CLI, HTTP API, library entry point): do the action, observe the effect, compare with the criterion, try the edges the spec lists. Record what you ran, what you saw, and the evidence (commands or clicks, output, request and response, logs) in files named after the criterion.
4. **Screenshots.** A criterion whose effect is seen in a web page needs at least one screenshot of it (`AC2.png`, or `AC2-1.png`, `AC2-2.png` for several states) in its `evidence`, for `pass` and `fail` alike. No browser in this session: `unverified`. Browser there but the capture failed: `fail` if what you saw was wrong, else `unverified`, with the reason.
5. **Each failure gets a repro**: the one command or the shortest user sequence that shows it, with preconditions, expected and observed. Make it tight: implementation turns it into a red test. If it is flaky, say how often it happened.
6. **For `person` criteria**, prepare what you can (how to run it, a URL, screenshots up to where you stopped) so a person checks it in minutes.

## Verdicts

Exactly one per criterion:

- `pass`: observed working in this session, with evidence. A passing test or code that looks right is not an observation.
- `fail`: observed not working, with a repro.
- `person`: only a person can judge it, whatever the tools (visual design, a real card, a third-party console); say `how`.
- `unverified`: a machine could check it, this session could not (no browser, no device, service down); give the `reason` and `how`. Never call it `person` to get past it.

A person's earlier ruling or approval never turns a criterion into `pass`: it judged older code. Cite it in a `person` verdict's `how` so the person confirms it on the current head.

A criterion that passed as written but that a person may read differently stays `pass`, with a **note** for a person, tied to that criterion, carrying the question. A note never replaces a verdict.

## Files

Write everything to one directory **outside the repository** (e.g. under `$TMPDIR`) unless told where: whatever is left in the worktree is committed when you report.

- `criteria.json`, the criteria report, one entry per criterion. Required: `evidence` for `pass`, `repro` for `fail`, `how` for `person`, `reason` and `how` for `unverified`; `evidence` may go on any.

  ```json
  [
    { "id": "AC1", "verdict": "pass", "evidence": "AC1.md" },
    { "id": "AC2", "verdict": "fail", "repro": "Add 'buy milk p1' on /today. Expected a red flag; actual none.", "evidence": "AC2.png" },
    { "id": "AC3", "verdict": "unverified", "reason": "no browser in this session", "how": "open /today, add 'buy milk p1', expect a red flag" },
    { "id": "AC4", "verdict": "person", "how": "compare the dialog with Figma frame 12; screenshot in AC4.png" }
  ]
  ```

- `findings.json`, when anything fails: one `blocking` finding per failing criterion, with `criterion`, `title` and `repro`, plus `file` and `line` when you know them. Whoever fixes it reads this first.

  ```json
  { "findings": [ { "id": "F1", "severity": "blocking", "criterion": "US12",
      "title": "Deleting an already-deleted item deletes a newer one",
      "repro": "Create A, delete it, create B, DELETE A's id again. Expected 404; actual 204 and B is gone.",
      "detail": "Ids are reused after delete. Evidence: US12-repro.md." } ] }
  ```

- one evidence file per criterion (`AC1.md`, `AC1.png`, …) and `report.md`, one line per criterion:

  ```markdown
  | Criterion | Verdict | Evidence | Note |
  |---|---|---|---|
  | AC1 (US3) | pass | AC1.md | |
  | AC2 (US4) | fail | AC2.md, AC2.png | repro inside |
  ```

**Redact every secret** in every file: `<REDACTED>` in text, cropped or blurred in screenshots.

## Report

The worst verdict decides what you may report: fail > unverified > person > pass; a report that contradicts it is refused. Pass the criteria file, the findings file (when written), the evidence directory and any notes to the report command your instructions name.

## Rules

- Never fix code. Report what you found.
- Stop the processes and remove the data you started.

Done when every criterion has exactly one verdict; every `pass` has evidence (a screenshot when seen in a browser); every `fail` has a repro and a finding; every `person` and `unverified` says how to check it; secrets are redacted; and `report.md` has one line per criterion.
