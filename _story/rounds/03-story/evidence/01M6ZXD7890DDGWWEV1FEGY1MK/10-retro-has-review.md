# Retro: gh-7 CSV export

Read: the record ref of gh-7 (`refs/norn/runs/gh-7` at `1409d36`; 1 round, 1 slice). Trace: not on this machine (no tool folder for this checkout), so this works from the record alone. The record also holds an empty `.idx.lock` file at its root, a leftover with no bearing on the story.

## Summary

One thing cost time: the story's sign-off was rejected once because review sent the work back over import order, which the person says the formatter owns, and says it happened "again". That cost one `review_loop` (1 of max 3) and a second sign-off. The change that would save the most is an automated formatter check ahead of review, so import order never reaches a reviewer.

## Findings

### 1. Review raised import order, costing a rework loop and a second sign-off

- **Cost**: 1 review loop (`review_loop` 1 of max 3), 1 person reject at `sign-off`, a second sign-off two hours later.
- **Evidence**: `_story/rounds/01-story/receipts/0005-reject.json` (comment: "Review sent this back over import order again. Never treat import order or blank lines as findings, in any story: the formatter owns that."), `_story/rounds/01-story/state.json` (`counters.review_loop: 1`), `_story/rounds/01-story/workflow.yaml` (`review_loop: { max: 3 }`). `REVIEW.md` already says "Do not report: Import order and blank-line style", so prose alone did not stop it; the record holds no review `findings` to show whether the rule was in place or read when review ran.
- **Change**: import order is a mechanical rule, so make it a check, not prose: add a check before the review step in the story workflow that runs the repo's formatter in check mode (e.g. `run: <formatter> --check .`, the formatter the person means by "the formatter owns that"; this repo has no formatter config or `package.json` yet, so it is named nowhere in the repo), failing the step back to implement before review sees the diff.
- **File**: `.agents/workflows/story.yaml` (the definition pinned as `name: story`; it is not in this checkout, so the change goes where the repo keeps that definition)

## Lasting preferences

Gate rulings (which read as a lasting preference? my reading after each):

- `_story/rounds/01-story/receipts/0005-reject.json`, gate `sign-off`, round 1 (`01-story`): "Review sent this back over import order again. Never treat import order or blank lines as findings, in any story: the formatter owns that." (lasting: "in any story" says so)
- `_story/rounds/01-story/receipts/0009-approve.json`, gate `sign-off`, round 1 (`01-story`): "Looks good, ship it." (this story only)

Neither ruling is delegated; both are the person's own. Do you read the first as a lasting preference, and the second as about this story only?

### 1. Never report import order or blank-line style as review findings

- **File**: `REVIEW.md`
- **Already stated**: `REVIEW.md`, section "Do not report": "Import order and blank-line style: the formatter owns them; never raise them as findings.", cited as evidence; no new line.
- **Ruling**: `_story/rounds/01-story/receipts/0005-reject.json` ("Never treat import order or blank lines as findings, in any story: the formatter owns that.")

## Went well

The slice went through implement in one attempt with no loops, asks or stuck reports (`01-export/receipts/0002-done.json`, `01-export/state.json`).

## Working tree after

```

```
