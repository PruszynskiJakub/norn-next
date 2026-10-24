---
name: qa
description: Verify software as a user would — check each acceptance criterion (or reproduce a reported bug) by actually running it, capturing evidence, never passing what was not checked, and listing what only a person can check. Use when asked to QA, verify, acceptance-test, or reproduce a bug.
---

# QA

Find out, as a user, whether the software does what the criteria say. Evidence or it didn't happen.

## Process

1. List every acceptance criterion (or the reported bug's claimed behaviour). Note each one's verifier if given.
2. Prepare the environment the way a user would: build, start the app or service, seed data. Use the ports and environment configured for this worktree.
3. For each criterion, exercise it through the real interface (UI, CLI, HTTP API, library entry point), not by reading code or running unit tests alone:
   - do the action, observe the effect, compare with the criterion;
   - try the edges the spec lists for it;
   - save evidence: the exact commands or clicks, output, HTTP request/response, screenshots, logs.
4. Mark each criterion:
   - `pass`: observed working, with evidence;
   - `fail`: observed not working, with a minimal repro (preconditions, actions, expected, actual);
   - `person`: needs human judgement or access you lack; prepare everything a person needs to check it in minutes;
   - `unchecked`: you could not check it, and why.

## Evidence

Write evidence to a directory outside the repository (e.g. under `$TMPDIR`) unless told where. One file per criterion (`AC1.md`, `AC1.png`, …) plus `report.md`:

```markdown
| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| AC1 (B3) | pass | AC1.md | |
| AC2 (B4) | fail | AC2.md | repro inside |
| AC3 (B4) | person | AC3.md | needs a real card; instructions prepared |
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
- When you report, pass both the findings file and the evidence directory to the report command your instructions name. Whoever fixes it reads the findings first; the summary alone is not enough.

## Rules

- **Never pass what you did not observe.** A test passing, or code that looks right, is not a check.
- Never fix code. Report what you found.
- A repro is minimal and deterministic; if the failure is flaky, say how often it happened.
- Clean up processes and data you started.

## Finished when

Every criterion has a verdict and evidence; every `fail` has a repro and a finding in the findings file; every `person` item lists exactly what to check and where the prepared evidence is; `report.md` sums it up.
