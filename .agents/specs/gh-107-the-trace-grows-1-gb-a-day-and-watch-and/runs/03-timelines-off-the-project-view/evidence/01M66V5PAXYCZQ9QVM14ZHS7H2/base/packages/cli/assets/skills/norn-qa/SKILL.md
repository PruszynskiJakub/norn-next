---
name: norn-qa
description: Check a change from the user's side, criterion by criterion (or reproduce a reported bug), by actually running it — collecting evidence for each, a screenshot for anything seen in a browser, and a repro for every failure — and give each criterion one verdict (pass, fail, person, unverified) in a criteria report; never pass what was not observed. Use when asked to QA, verify, acceptance-test, or reproduce a bug.
---

# QA

You QA on your own and collect the evidence. A person may QA after you; your pack is where they start. Evidence or it didn't happen.

1. **Run the full test suite** on the branch in this worktree, as it is, so you know what you are checking.
2. **Read who verifies what.** List every acceptance criterion (or the reported bug's claimed behaviour) with its id. When the slice or story file lists `criteria` in its frontmatter, those ids are the list: give a verdict for each of them, and for no other id. Note each one's verifier and `needs` (e.g. `browser`). A criterion whose verifier is `person` says why; that reason marks what only a person can check.
3. **Prepare the environment** the way a user would: build, start the app or service, seed data. Use the ports and environment configured for this worktree.
4. **Check every other criterion as a user would**, through the real interface (UI, CLI, HTTP API, library entry point): run the app, the command, the request, never only the tests or the code.
   - do the action, observe the effect, compare with the criterion;
   - try the edges the spec lists for it;
   - record what you ran, what you saw, and the evidence: the exact commands or clicks, output, HTTP request and response, logs. Save evidence files under names that say which criterion they belong to.
5. **Screenshots.** Every criterion with `needs: [browser]`, and every other criterion whose effect is seen in a web page, gets at least one screenshot of the effect, named after the criterion (`AC2.png`, or `AC2-1.png`, `AC2-2.png` for several states) and listed in its `evidence`. A screenshot is required for `pass` and for `fail` alike: a UI criterion with no screenshot is never `pass`. With no browser in this session, it is `unverified`. When the browser is there but the capture failed, it is `fail` if what you saw was wrong, otherwise `unverified`, with the reason.
6. **For each failure, capture a repro**: the one command or the shortest sequence of user actions that shows it, with preconditions, expected and observed results. Make it as tight as you can: implementation turns it into a red test. If it is flaky, say how often it happened.
7. **For what only a person can check**, prepare what you can: how to run it, a URL, screenshots up to the point you could not pass. Its verdict is `person`.

## Verdicts

Give each criterion exactly one:

- `pass`: observed working, with evidence;
- `fail`: observed not working, with a minimal repro;
- `person`: needs a person's judgement or access you lack (visual design, a real card, a third-party console); prepare everything a person needs to check it in minutes and say how;
- `unverified`: a machine could check it, but this session could not (no browser, no device, service down); say why, and exactly how to check it.

Choosing between `unverified`, `person` and a note:

- `unverified` is about this session: an agent with the right tools could check it. Use it when a criterion needs a capability you do not have here (its `needs` often says which). Never call it `person` to get past it, and never `pass` it.
- A person's earlier ruling or approval answers questions; it never turns a criterion into `pass`. It judged the code at the head it was given at, and the code may have changed since (a merge, a fix). At most it informs a `person` verdict: cite it in that verdict's `how` so the person confirms it on the current head. A criterion needing a capability this session lacks (e.g. `browser`) is `unverified` with how to check it — even if a person accepted it before; a `pass` for it is refused.
- `person` is about the criterion: only a person can judge it, whatever the tools.
- A **note** is for a criterion that passed as written, where a person may still disagree with how you read it (e.g. the criterion says "trimmed" and you kept whitespace inside backticks). The verdict stays `pass`; the note carries the question so a person sees it without the work stopping. Notes never replace a verdict.

Never pass a criterion you could not check. A test passing, or code that looks right, is not a check.

## Criteria report

Write the verdicts as JSON to a file next to the evidence (e.g. `criteria.json`), one entry per criterion:

```json
[
  { "id": "AC1", "verdict": "pass", "evidence": "AC1.md" },
  { "id": "AC2", "verdict": "fail", "repro": "Add 'buy milk p1' on /today. Expected a red flag; actual none.", "evidence": "AC2.png" },
  { "id": "AC3", "verdict": "unverified", "reason": "no browser in this session", "how": "open /today, add 'buy milk p1', expect a red flag" },
  { "id": "AC4", "verdict": "person", "how": "compare the dialog with Figma frame 12; screenshot in AC4.png" }
]
```

- Required: `evidence` for `pass`, `repro` for `fail`, `how` for `person`, `reason` and `how` for `unverified`. `evidence` may be added to any verdict.
- The worst verdict decides what you may report: fail > unverified > person > pass. When you report, pick the one whose meaning matches your worst verdict; a report that contradicts it is refused.
- Pass the criteria file to the report command your instructions name, with the findings file and the evidence directory, and any notes for a person.

## Evidence

Write evidence to a directory outside the repository (e.g. under `$TMPDIR`) unless told where. One file per criterion (`AC1.md`, `AC1.png`, …) plus `report.md`, one line per criterion:

```markdown
| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| AC1 (B3) | pass | AC1.md | |
| AC2 (B4) | fail | AC2.md, AC2.png | repro inside |
| AC3 (B4) | unverified | AC3.md | no browser here; how to check inside |
| AC4 (B5) | person | AC4.md | needs a real card; instructions prepared |
```

**Redact every secret** in what you record and in every evidence file: write `<REDACTED>` in its place, and crop or blur it in screenshots.

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

- Never fix code. Report what you found.
- Clean up processes and data you started.

Done when every criterion has exactly one verdict in the criteria file; every `pass` has evidence, and a screenshot when its effect is seen in a browser; every `fail` has a repro and a finding in the findings file; every `person` and `unverified` entry says exactly how to check it; questions about how you read a passed criterion are notes; secrets are redacted; and `report.md` sums it up, one line per criterion.
