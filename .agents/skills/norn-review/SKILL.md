---
name: norn-review
description: Reviews a change against its spec and the repo's standards, judging the two apart, and writes findings as JSON with a blocking flag; never edits code. Use when asked to review a diff, branch, pull request or slice against its acceptance criteria.
---

# Review

Without this, a change ships that passes its tests but misses what was asked, or does what was asked in a way the repo forbids, and nobody can tell which criterion a test proves. Judge the change; do not fix it. You never edit code during a review.

Two axes, kept apart so one cannot mask the other: tidy code can hide a missing criterion, and a complete feature can hide a broken rule.

- **Spec**: does the change do what the slice (or story) and the spec ask, and nothing else?
- **Standards**: does it follow this repo's documented standards and the smell baseline?

The order below matters where it is numbered; how deep each part goes is yours to fit to the change.

1. **Check the earlier findings first.** A re-review is given the previous review's findings; settling them before the diff keeps a fresh read from forgetting them. Read each one against the current code at its file and line: fixed or not fixed, with the line you read. A blocking (or major) one not fixed is a blocking finding of this round, under its own title. A minor or nit one not fixed stays a note: it never sends the work back on its own, and you do not raise it again. Put the verdicts in the summary. With no earlier findings, go straight to the diff.
2. **Pin the diff** against the branch the change targets, or the range you were given (`git diff <base>...HEAD`, `git log <base>..HEAD --oneline`), so both axes judge the same change. An empty diff stops the review: report it instead.
3. **Gather the sources.** Spec: the acceptance criteria, the spec's user stories they cite, and its Plan (reviewing a whole story covers the whole spec). Standards: whatever the repo documents about how code is written (`CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, coding-standard docs, lint and type config), plus [SMELLS.md](SMELLS.md). Run the tests and the type check the repo documents as its local loop, if you can; a red suite is a blocking finding.
   - **`REVIEW.md`** at the repo root, when present, is the repo's word on this review and overrides the baseline: paths it says to ignore or skip are not reviewed (no finding cites them), what it says counts as failure is blocking, and what it says not to report is not reported (when it forbids nits, report none). Both axes need it in full.
   - **Sensitive paths.** When `REVIEW.md` marks paths sensitive (a list of folders or files that need a closer look) and the diff touches any of them, the Standards axis also applies [SECURITY.md](SECURITY.md) to those hunks. Its findings are bugs, so blocking.
4. **Judge each axis.** Run each in its own subagent, in parallel, so neither reads the other's conclusions; give each the diff command, the commit list, its sources in full and `REVIEW.md` when present, and tell it what it must cover (below) rather than a script. When you cannot start subagents, judge both yourself, Spec first, and write the Spec findings down before you open the standards. Either way, findings name a file and line, and say why they matter; a long list of small points buries the one that blocks, so lead with what would send the work back.
   - **What Spec covers.** First the traceability table (below): one row per user story and acceptance criterion, each naming the test that proves it, or `UNTRACED`. A test counts only once read and seen to assert that item, since a test named after a criterion often checks something else. Then whatever leaves the spec unmet: criteria or user stories missing, partial, or met for the happy path only; behaviour nobody asked for, or that the spec lists as out of scope; criteria implemented wrongly; tests at a seam the Plan did not agree, or that check internals or recompute their expected value, because those pass while the behaviour breaks. Quote the spec line a finding breaks.
   - **What Standards covers.** Breaches of a documented standard, citing the rule; bugs (off-by-one, null paths, races, resource leaks, wrong units, injection, silent catches, leaked secrets, debug leftovers); the smells of the baseline, named with the hunk; and, when the diff touches a path `REVIEW.md` marks sensitive, every breach of the security checklist in those hunks, as a bug. A documented standard overrides the baseline, and smells are judgement calls. Skip what tooling already enforces: it fails on its own.
   - **Subagents that run commands** (an axis running the suite, a check of a blocking finding trying the input) get these rules with their reasons, since they see only what you give them:
     - No push — the branch belongs to whoever runs the review; a push publishes work nobody has judged yet.
     - No branch or worktree switch — the checkout is shared with the session that started the review; a switch moves its files under it and the review then reads a different change.
     - No command of the delivery tool that started the review — those commands report and advance the work; a subagent running one acts for the reviewer and can end the review before it is written.
     - No writes under the delivery tool's run state (its `runs/` folders and their state files) — the tool reads them as the record of what happened; a stray write corrupts the record or makes it guess.
5. **Verify each blocking candidate** before you decide, because an axis that raised a finding is the worst judge of it. A candidate is anything Decide (below) would make blocking. Check it again in a fresh subagent given only the finding, the diff command and the sources it cites: it reads the code at the file and line and the spec or rule cited, tries the input if one is named, and answers holds or does not hold with the line it read. When you cannot start subagents, re-read the cited code and source yourself. Drop a candidate that does not hold, or that cites a path `REVIEW.md` ignores; keep one that holds. Never drop a red suite or an `UNTRACED` row this way: re-run or re-read to confirm, and keep it when it still stands.
6. **Decide.** Every Spec finding, every bug and every hard Standards breach is blocking. An `UNTRACED` row is a blocking Spec finding, unless the criterion's `verifier` in the slice (or story) frontmatter `criteria` is `agent` or `person`: no test is expected for those, so the row reads `QA (agent)` or `QA (person)` and points at QA, which gives its verdict in the criteria report. A user story or criterion with no frontmatter entry counts as `verifier: test`. Add a smell only when it is worth a round of rework on its own; otherwise it is minor or a nit. Any blocking finding means changes requested; none means approve. Only blocking findings are rework: minor and nit ones are notes, left for the person, never fixed in another round.
7. **Write the table into the handoff's Proof section**, replacing the table an earlier review left there, so QA and the PR body can reuse it; each `UNTRACED` row also goes under Not proven yet:

```markdown
| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | an expired invite is rejected | test | `packages/core/test/unit/invites.test.ts` › "rejects an expired invite" |
| AC2 | the inviter sees who joined | test | UNTRACED |
| AC3 | the invite email reads well | person | QA (person) |
```

   One row per acceptance criterion, by its id and what it says; a user story no criterion covers gets a row of its own, in words with no id. The words column is never empty: the next reader, agent or person, has only the table. Every `UNTRACED` row has its finding.
8. **Write the findings** as JSON to a file outside the repository (e.g. under `$TMPDIR`) unless told where, and hand that file over with your verdict. Keep the axes separate; do not merge or rerank them. The fields are read by code, so keep them exactly as below.

```json
{
  "summary": "One paragraph: overall verdict and the most important issues.",
  "findings": [
    {
      "id": "F1",
      "axis": "spec",
      "severity": "blocking",
      "criterion": "AC2",
      "file": "src/invites/accept.ts",
      "line": 42,
      "title": "Expired invites are accepted",
      "detail": "What is wrong and how you know (test, input, trace); the spec line it breaks.",
      "suggestion": "What would fix it, briefly."
    }
  ]
}
```

- `axis`: `spec` | `standards`. `severity`: `blocking` | `minor` | `nit`. `file` and `line` are required: the place the finding is about (for a missing behaviour, where it belongs, e.g. the function that should handle it). `criterion` is optional.
- The summary states the count (`2 findings, 1 blocking`), then each earlier finding fixed or not fixed when there were any, and says plainly when there are none (`No findings.`); an empty `findings` list is valid.
- Each finding is a concrete, checkable point: where, what, why, and how to verify the fix. Group repeated occurrences into one finding with all locations in `detail`.
