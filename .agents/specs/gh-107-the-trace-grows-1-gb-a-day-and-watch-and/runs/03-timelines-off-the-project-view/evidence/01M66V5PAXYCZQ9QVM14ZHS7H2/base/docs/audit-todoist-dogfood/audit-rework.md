# Rework briefing deep-dive: F22, F31, F17

Read-only audit. norn at `2bf136d` (branch `norn-v1`). The sandbox ran norn from source through `norn-sandbox-todoist/.bin/norn` (`exec bun …/norn/packages/cli/src/main.ts`), so the stored briefings come from this exact `brief.ts`. The `norn` on PATH is an unrelated v0.11 build.

I re-rendered each brief with the current `renderBrief` over the real receipts (scratch script `scratchpad/rework-repro/repro.ts`, pure, writes nothing). All three defects reproduce exactly:

| Case | Re-rendered `json.rework` |
|---|---|
| gh-1 implement#1 (after `qa.fail`) | `null` |
| gh-2/03 implement#2 (after `human-qa.reject`) | `from: human-qa.reject`, `findings: {step: review, outcome: approve, items: [3]}`, no comment |
| gh-2/03 qa#1 (after `review.approve`) | `from: review.approve`, `findings: {review: approve}` |

---

## 1. Reconstruction

### F22: gh-1 story, `qa.fail` leads to an implement brief with no Rework section

`norn trace gh-1 --text`, without the noop lines:

```
16:45:26.108Z receipt  started qa#1 (manual, claude)
16:49:03.542Z receipt  done fail at qa#1 — Story QA via curl on :4040: 31/32 Behaviour items + tests AC pass. FAIL B12/edge 'delete already-deleted -> 404': ids o…
16:49:38.198Z tick     receipts.apply → apply_receipts
16:49:52.921Z receipt  started implement#1 (manual, claude)
16:49:52.936Z briefing briefing for run 01M5MTPFRRM90Q144WTKA8T5PK at implement#1: briefings/01M5MTPFRRM90Q144WTKA8T5PK/01M5MTPFS7V7GS2NTA10XEDVF3.md
16:52:41.205Z receipt  done done at implement#1 — QA B12 rework: ids of deleted items/projects were reused …
16:53:13.077Z receipt  check pass at test#2
```

(`norn why gh-1` only shows the latest tick, `story.finished`, so it does not help after the fact.)

The triggering receipt is `.agents/specs/gh-1-projects-and-items/runs/_story/receipts/0011-done.json`:

```json
{ "kind": "done", "receipt_id": "01M5MTMZHN65KY2P462S94VHJ5", "run_id": "01M5MTEB6T37MVRHZ5FADDAQTK",
  "step": "qa", "attempt": 1, "by": "agent", "outcome": "fail",
  "handoff": "Story QA via curl on :4040: 31/32 Behaviour items + tests AC pass. FAIL B12/edge 'delete already-deleted -> 404': ids of deleted items/projects are reused (INTEGER PRIMARY KEY without AUTOINCREMENT in src/store.ts), so a stale/retried DELETE /api/items/N returns 204 and deletes an unrelated newer item. Repro in B12-repro.md. …",
  "evidence": "evidence/01M5MTEB6T37MVRHZ5FADDAQTK" }
```

The receipt has no `findings`. The evidence is in `runs/_story/evidence/01M5MTEB6T37MVRHZ5FADDAQTK/` (B12-repro.md, report.md, …).

Story receipts before that point: 0009 `check pass` (test#1), 0010 `started qa`, 0011 `done fail`. The story unit has no failing check and no receipt with findings.

The stored brief is `.agents/norn/trace/briefings/01M5MTPFRRM90Q144WTKA8T5PK/01M5MTPFS7V7GS2NTA10XEDVF3.md`. Its Inputs end with:

```
- Last failing check: `see Rework`
- Last findings: `see Rework`
```

Then it goes straight to `## Context`. There is no `## Rework`. The only trace of the failure is the `qa#1 fail: …` progress line under Context → Progress, which came from handoff.md and was written by `done.ts:94 appendProgress`. That line has the relative name "B12-repro.md" and no evidence path. The agent found the right fix anyway, but only by reading Progress.

### F31: gh-2/03, `human-qa.reject` comment missing; stale review findings shown instead

`norn trace gh-2/03 --text`:

```
17:27:58.199Z receipt  done approve at review#1 (3 findings) — review#1: approve. …
17:28:22.141Z briefing … qa#1: briefings/01M5MWWYVA3RSHY979ARH9HSAE/…      ← F17 instance
17:29:31.724Z receipt  done partial at qa#1 — … Review finding 1 confirmed server-side …
17:29:55.205Z receipt  reject human-qa: AC7: on 404/5xx the inline due-date editor shows the raw HTML error page as the row's error text (review F1, confirmed by …
17:30:23.985Z briefing … implement#2: briefings/01M5MX0NTECSV7HSCAAXCPGGMS/01M5MX0NVHEVX62W0CQV18EXND.md
```

The triggering receipt is `runs/03-due-dates-in-project-lists/receipts/0008-reject.json`:

```json
{ "kind": "reject", "receipt_id": "01M5MWZSR593G0AP11JSHKNKC5", "run_id": null, "step": "human-qa", "attempt": 1,
  "by": "human", "slice": "gh-2/03",
  "comment": "AC7: on 404/5xx the inline due-date editor shows the raw HTML error page as the row's error text (review F1, confirmed by QA). Show a short human message instead (e.g. 'Item not found' / 'Could not save the date'), with a test." }
```

Receipts in the unit: 0001 started impl#1, 0002 done impl#1, **0003 check pass**, 0004 started review, **0005 done review approve + 3 findings (minor, minor, nit)**, 0006 started qa, 0007 done qa partial (+evidence), **0008 reject**.

The Rework section actually rendered (stored brief, identical to `scratchpad/brief-gh2-03-rework.md`):

```
## Rework

You are here because of `human-qa.reject`. Address every point below first.

### Findings (review: approve)

1. **minor** [AC7] Non-400 error bodies are shown raw as the row error — `src/views.ts:191` …
2. **minor** No style for li.overdue; only the due span is coloured — `src/views.ts:72` …
3. **nit** Script test asserts on substrings of the source — `test/web.test.ts` …
```

The comment text appears nowhere in the brief (`grep 'Item not found'` = 0):

- Rework ignores it.
- handoff.md never gets it, because only `done` appends progress (`cli/src/commands/done.ts:94`). The approve/reject command does not.
- The header shows only "Last outcome: human-qa.reject".

The agent was told to "address every point" of an *approve* review, including an optional nit.

### F17: forward transitions framed as rework

Of 57 stored briefings, 14 have `## Rework`. 13 of those are `qa#n` briefs that open with "You are here because of `review.approve`. Address every point below first." (gh-1/01..04, gh-2/01..03, gh-3/01..03, gh-4/01..02, gh-2/03 qa#2). The 14th is F31. None is the real qa.fail rework (F22).

---

## 2. Root cause in code

All references are to `packages/core/src/brief.ts` unless noted.

- **brief.ts:131-132.** There are only two failure predicates:
  - `isFailingCheck`: a `check` receipt with `outcome === "fail"`;
  - `hasFindings`: a `done` receipt with `findings.length > 0`, **regardless of outcome**.
- **brief.ts:151.** `entering` is the receipt named by `state.last_outcome.receipt_id`, when it came from another step.
- **brief.ts:152.** `fromFailure = isFailingCheck(entering) || hasFindings(entering) || classify.conflict`. Neither a failing outcome nor a gate rejection appears in this rule.
- **brief.ts:140-145 (`liveSince`).** This drops everything before the last passing check or the last receipt of an earlier attempt of this step.
- **brief.ts:156-157.** Declared `last_check` and `last_findings` fall back to `live.findLast(isFailingCheck | hasFindings)`.
- **brief.ts:158.** `detail` is set only for `classify` receipts.
- **brief.ts:159.** If none of check, found or detail is set, the function returns `null`.
- **brief.ts:124-126.** `inputs()` always renders `last_check` and `last_findings` as "see Rework", even when `rework()` returns null. That is a dangling pointer.

**(a) qa.fail with handoff text but no `--findings`.** The entering receipt 0011 is `done/fail` without findings, so `fromFailure` is false (`:152`). `implement` declares `last_check` and `last_findings` (story workflow), so execution continues past `:153`. `live` is [0010, 0011] (cut at 0009 check pass). It holds no failing check and no receipt with findings, so `check`, `found` and `detail` are all null and the function returns null at `:159`. Neither `handoff` nor `evidence` of a `done` receipt is a rework source anywhere. Meanwhile `:126` still prints "see Rework". So the brief reads only `findings` from a failing `done`, and the QA skill never produces findings (see §3).

**(b) Gate reject comment ignored.** `rework()` has no branch for `kind: "reject"` (or `approve`/`unstick`) and never reads `comment`. At `:152`, entering = 0008 (reject), so `fromFailure` is false. The declared fallback at `:157` takes `live.findLast(hasFindings)` over [0004..0008]. The cut is at 0003, the last passing check, which is also later than impl#1's 0002. That returns **0005, the review *approve*** receipt, whose findings `hasFindings` accepts because it ignores outcome. `from` (`:161`) is built from `last_outcome`, so the header correctly says "human-qa.reject" while the body shows a different receipt.

The unit test pins this behaviour. `packages/core/test/brief.test.ts:113-140` ("declared inputs drop findings and checks that a later pass settled") ends with `reject {comment: "button is off-screen"}` and asserts `rework` is **null**, so the comment being dropped is the expected result.

**(c) approve-with-findings becomes rework on forward steps.** At `:152`, `hasFindings(entering)` is true for `review.approve` (outcome ignored), so `fromFailure` is true even though `qa` declares no `last_*` inputs. `:157` then shows those findings, and `:244` always uses the imperative framing "You are here because of … Address every point below first." Nothing checks whether the edge taken was a rework edge. The workflow already encodes that: every backward edge carries a `counter` (`test.fail`, `review.changes_requested`, `qa.fail`, `human-qa.reject`, `ready.reject`, `integrate.conflict`, `approve-plan.reject`). `apply.ts:288-301` (`take`) uses this, but `brief.ts` never consults `edgeOf`.

**`commands/brief.ts` and `runtime/agent-unit.ts`.** Receipts are passed whole (`brief.ts:155 receipts: s.receipts`, loaded by `agent-unit.ts:60,74`), so the data was available. The losses are in the core selection logic, not in the inputs:

- `paths.unit_dir` is repo-relative (`commands/brief.ts:151`), so any evidence path built from it would be relative to the worktree, not absolute.
- `check_log` (`commands/brief.ts:99-104`) is read only for the latest failing check. That is fine, but it is the only file-backed rework input. Evidence directories are never listed.

---

## 3. Schema and skill

`packages/schema/src/receipt.ts`:

- **`DoneReceipt` (:64-70):** `outcome`, `handoff` (required string), `findings?: Finding[]`, `evidence?` (relative `evidence/<run_id>`). A qa `fail` therefore carries the handoff (always), evidence (optional) and findings (optional). Nothing marks a finding or outcome as blocking.
- **`Finding` (:48-62):** `id, severity (blocking|major|minor|nit), title, detail, file, line, criterion, repro`. The `repro` and `criterion` fields fit QA failures, but nothing produces them for QA.
- **`RejectReceipt` / `ApproveReceipt` (:85-86):** `comment?: string` only. There are no findings, no evidence, and no link to the receipt being judged.
- **`UnstickReceipt` (:87-91):** `to`, `reset`, `comment?`.

`packages/cli/assets/skills/qa/SKILL.md` **never mentions `--findings`**:

- It tells the agent to write `report.md` plus per-criterion files to a directory outside the repo (:26).
- It requires "every `fail` has a repro" (:45), but only as prose in evidence files.

The generic `norn/SKILL.md:44` says "Pass the findings file or evidence directory your skill produced". QA produces no findings file, so in practice qa.fail = handoff + `--evidence`. The review skill does produce findings JSON (review/SKILL.md:38-68), which is why only review receipts ever reach Rework. `implement/SKILL.md:13-17` expects "a QA repro" in Rework, which the brief cannot currently deliver.

---

## 4. Fix design (no code edited)

### 4.1 Rule: entered from a failure vs forward

- Let `edge = edgeOf(workflow, last_outcome.step, last_outcome.outcome)`, using the pinned workflow already in `BriefInput`.
- **Rework iff** `last_outcome.step !== st.step` **and** `edge.counter` is set (the workflow's own definition of a fix round, W4).
- Fallback for workflows without counters: the entering receipt is `check.fail`, `reject`, `classify.conflict`, or a `done` whose outcome is not `pass|approve|done|partial`.
- Exhausted, stuck and unstick are not rework.
- Optionally persist this at `take()` time as `state.entered = {from, outcome, receipt_id, counter}`, so the brief does not re-derive it. That would be a schema change, so it is not required.
- A forward entry (e.g. `review.approve → qa`) **never** renders `## Rework`. Non-blocking findings from the previous step may go under Context as "### Notes from review (non-blocking)", in neutral wording with no "Address every point". Alternatively drop them, since qa has the handoff.

### 4.2 What feeds Rework (the entering receipt first, always)

| Entering receipt | Rendered |
|---|---|
| `check` fail | As today: command, exit/reason, absolute log path, log tail (60 lines) |
| `done` (agent) with a failure outcome | `### <step> reported <outcome>` with the **full `handoff` text** (it is the reason), then `findings` if present (with repro and criterion), then **absolute evidence path** `<worktree>/<spec_dir>/runs/<unit>/<evidence>/` and its file list (e.g. `B12-repro.md`, `report.md`) |
| `reject` (gate) | `### Rejected at <step> by <who>`, then the **`comment` verbatim**. Also point to what was judged, i.e. the receipt the gate looked at (the previous `done` at the step before the gate): its handoff summary and its absolute evidence path. If there is no comment, say "(no comment given; ask the person or see the evidence)". |
| `classify` conflict | As today (`detail`) |

### 4.3 Declared `last_check` / `last_findings` (B6), corrected

- These add context only when they are **failures**:
  - failing checks;
  - `done` receipts whose outcome routed over a counter edge, e.g. `review.changes_requested` (not `review.approve`);
  - their findings, filtered to `blocking|major` unless they came from the entering receipt.
- "Settled" is per kind:
  - a passing check settles earlier failing checks only;
  - a later receipt of the same step with a non-failure outcome settles that step's earlier failures (`qa.partial` settles `qa.fail`, `review.approve` settles `changes_requested`);
  - the previous attempt of the current step still cuts everything before it (fix-group-4 cut, keep).
- When nothing is live, `inputs()` must not print "see Rework". Omit the line, or print "none".

### 4.4 Framing

- On rework: "You are here because `<step>.<outcome>` sent the work back (fix round `<counter> n/max`). Address the points below first."
- Use `blocking`/`major` severities as the must-fix list and `minor`/`nit` as "consider".
- Use absolute paths (the brief already has `paths.worktree`). Pass `runs_dir` (absolute, `s.runsDir`) and an `evidence_files` listing from `commands/brief.ts` so that `renderBrief` stays pure.

### 4.5 Upstream data fixes

- **QA skill:** on `fail`, write a findings JSON with one `Finding` per failing criterion (`criterion`, `title`, `repro`, `severity: blocking`) and pass `--findings` and `--evidence`. Update `norn/SKILL.md` to say a failing outcome needs `--findings` (optionally make `norn done fail` without findings a warning).
- **approve/reject:** `--reject` without `--comment` should warn. Also append the decision with its comment to handoff.md Progress (`human-qa#1 reject: <comment>`) the way `done.ts:94` does, so Context carries it too.
- **`norn trace --text`:** stop truncating the reject comment (it is cut at about 140 chars).

### 4.6 Tests to pin it (`packages/core/test/brief.test.ts` snapshots)

1. **qa.fail, handoff + evidence, no findings (F22).** Rework present, handoff text verbatim, absolute evidence dir with files listed. Inputs have no dangling "see Rework".
2. **qa.fail with a findings file.** Findings with `criterion`/`repro` rendered, then evidence path.
3. **human-qa.reject with a comment, preceded by review.approve with minor/nit findings (F31).** Rework = comment verbatim + qa partial evidence path. Review approve findings **absent** from Rework.
4. **reject with no comment.** "(no comment given)" plus a pointer to the judged receipt's evidence.
5. **ready.reject (story) and approve-plan.reject → plan.** The comment is shown, including for a step that declares no `last_*`.
6. **review.approve with findings → qa (F17).** `json.rework === null`, no `## Rework` in the markdown, optional neutral notes block.
7. **review.changes_requested → implement.** Unchanged from today (blocking first).
8. **test.fail after implement#2 of a qa rework.** Shows the check. Declared `last_findings` does not resurrect qa#1's findings (cut by the previous attempt).
9. **Flip the existing test at brief.test.ts:113-140.** It must now expect the reject comment "button is off-screen", not `null`.
10. **unstick --to implement with a comment.** Not rework (no counter edge). The comment may show in Context.
11. **Fixture replay of the two sandbox units** (receipts 0001-0011 of gh-1 `_story`, 0001-0008 of gh-2/03) as golden briefs.

### 4.7 Did fix-group-4 ("only failures newer than step entry", audit item 16, `liveSince` at brief.ts:134-145) contribute?

**Not to the observed output.**

- **gh-1:** the unit has no failing check and no receipt with findings at all, so the result was null with or without the cut.
- **gh-2/03:** the review#1-approve receipt (0005) is newer than both cut points (0003 check pass, 0002 impl#1), so the pre-fix `findLast` over all receipts would also have picked it.

**It did entrench the bug, though, in three ways:**

- It defined "live" as "not settled by a passing check". That treats an approve review's findings as unsettled failures.
- It added no outcome check.
- Its test (brief.test.ts:113-140) codifies "reject with a comment yields no Rework".

The cut by the previous attempt of the current step is sound and should be kept. Only the "what counts as a failure" predicate and the "pass settles everything" rule need to change.
