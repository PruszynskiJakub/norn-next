---
name: qa
description: Verify software as a user would — check each acceptance criterion (or reproduce a reported bug) by actually running it, capturing evidence, and giving each criterion one verdict (pass, fail, person, unverified) in a criteria report; never passing what was not observed, and leaving notes for a person when a passed criterion may be read differently. Use when asked to QA, verify, acceptance-test, or reproduce a bug.
---

# QA

Find out, as a user, whether the software does what the criteria say. Evidence or it didn't happen.

## Process

1. List every acceptance criterion (or the reported bug's claimed behaviour) with its id. When the slice or story file lists `criteria` in its frontmatter, those ids are the list: give a verdict for each of them, and for no other id. Note each one's verifier and `needs` (e.g. `browser`).
2. Prepare the environment the way a user would: build, start the app or service, seed data. Use the ports and environment configured for this worktree.
3. For each criterion, exercise it through the real interface (UI, CLI, HTTP API, library entry point), not by reading code or running unit tests alone:
   - do the action, observe the effect, compare with the criterion;
   - try the edges the spec lists for it;
   - save evidence: the exact commands or clicks, output, HTTP request/response, screenshots, logs.
4. Give each criterion exactly one verdict:
   - `pass`: observed working, with evidence;
   - `fail`: observed not working, with a minimal repro (preconditions, actions, expected, actual);
   - `person`: needs a person's judgement or access you lack (visual design, a real card, a third-party console); prepare everything a person needs to check it in minutes and say how;
   - `unverified`: a machine could check it, but this session could not (no browser, no device, service down); say why, and exactly how to check it.

## Choosing between `unverified`, `person` and a note

- `unverified` is about this session: an agent with the right tools could check it. Use it when a criterion needs a capability you do not have here (its `needs` often says which). Never call it `person` to get past it, and never `pass` it.
- `person` is about the criterion: only a person can judge it, whatever the tools.
- A **note** is for a criterion that passed as written, where a person may still disagree with how you read it (e.g. the criterion says "trimmed" and you kept whitespace inside backticks). The verdict stays `pass`; the note carries the question so a person sees it without the work stopping. Notes never replace a verdict.

## Criteria report

Write the verdicts as JSON to a file next to the evidence (e.g. `criteria.json`), one entry per criterion:

```json
[
  { "id": "AC1", "verdict": "pass", "evidence": "AC1.md" },
  { "id": "AC2", "verdict": "fail", "repro": "Add 'buy milk p1' on /today. Expected a red flag; actual none." },
  { "id": "AC3", "verdict": "unverified", "reason": "no browser in this session", "how": "open /today, add 'buy milk p1', expect a red flag" },
  { "id": "AC4", "verdict": "person", "how": "compare the dialog with Figma frame 12; screenshot in AC4.png" }
]
```

- Required: `evidence` for `pass`, `repro` for `fail`, `how` for `person`, `reason` and `how` for `unverified`. `evidence` may be added to any verdict.
- The worst verdict decides what you may report: fail > unverified > person > pass. When you report, pick the one whose meaning matches your worst verdict; a report that contradicts it is refused.
- Pass the criteria file to the report command your instructions name, with the findings file and the evidence directory, and any notes for a person.

## Evidence

Write evidence to a directory outside the repository (e.g. under `$TMPDIR`) unless told where. One file per criterion (`AC1.md`, `AC1.png`, …) plus `report.md`:

```markdown
| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| AC1 (B3) | pass | AC1.md | |
| AC2 (B4) | fail | AC2.md | repro inside |
| AC3 (B4) | unverified | AC3.md | no browser here; how to check inside |
| AC4 (B5) | person | AC4.md | needs a real card; instructions prepared |
```

## Findings

When any criterion is `fail`, also write the failures as JSON to a file next to the evidence (e.g. `findings.json`), one finding per failing criterion:

```json
{
  "findings": [
    {
      "id": "F1",
      "severity": "blocking",
      "criterion": "B12",
      "title": "Deleting an already-deleted item deletes a newer one",
      "repro": "Create item A, delete it, create item B, DELETE A's id again. Expected 404; actual 204 and B is gone.",
      "detail": "Ids are reused after delete. Evidence: B12-repro.md."
    }
  ]
}
```

- `severity` is `blocking` for a failed criterion; `criterion`, `title` and `repro` are required for a fail, `file` and `line` when you know them.
- When you report, pass the criteria file, the findings file and the evidence directory to the report command your instructions name. Whoever fixes it reads the findings first; the summary alone is not enough.

## Rules

- **Never pass what you did not observe.** A test passing, or code that looks right, is not a check. What you could not observe here is `unverified`.
- Never fix code. Report what you found.
- A repro is minimal and deterministic; if the failure is flaky, say how often it happened.
- Clean up processes and data you started.

## Finished when

Every criterion has exactly one verdict in the criteria file; every `pass` has evidence; every `fail` has a repro and a finding in the findings file; every `person` and `unverified` entry says exactly how to check it; questions about how you read a passed criterion are notes; `report.md` sums it up.
