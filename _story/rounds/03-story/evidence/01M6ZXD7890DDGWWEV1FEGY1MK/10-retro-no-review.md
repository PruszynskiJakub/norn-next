# Retro: gh-7 CSV export

Read: the record ref of gh-7 (`refs/norn/runs/gh-7`, commit `c40ead1`; 1 round, 1 slice), the spec folder `.agents/specs/gh-7-csv-export/` (spec, slice `01-export.md`, `handoffs/_story.md`). Trace: not on this machine, so this retro works from the record alone (no permission prompts, refused reports or failed actions can be seen).

## Summary

One thing cost time: review sent the story back over import order, a formatting matter the person says the formatter owns, and the person had to reject at sign-off to say so ("again", so it has happened before). Telling review never to report import order or blank lines, in `REVIEW.md` (new file), removes that loop for every story.

## Findings

### 1. Review sent the work back over import order, which the formatter owns

- **Cost**: one review loop (`review_loop` 1 of max 3) and one person reject at sign-off, with a second sign-off two hours later; the person's "again" says this is not the first story it happened on.
- **Evidence**: `_story/rounds/01-story/receipts/0005-reject.json` (gate `sign-off`, comment: "Review sent this back over import order again. Never treat import order or blank lines as findings, in any story: the formatter owns that."); `_story/rounds/01-story/state.json` (`counters.review_loop: 1`) against `_story/rounds/01-story/workflow.yaml` (`review_loop: { max: 3 }`). The record holds no review `done` receipt with the findings themselves, so the reject comment is the only account of what review reported.
- **Change**: add to review's standards the line "Never report import order or blank lines as findings: the formatter owns them." (the same line as Lasting preference 1; one change covers both).
- **File**: `REVIEW.md` (new file at the repo root)

## Lasting preferences

Gate rulings (which read as a lasting preference? my reading after each):

- `_story/rounds/01-story/receipts/0005-reject.json`, gate `sign-off`, round 1 (`01-story`), by the person: "Review sent this back over import order again. Never treat import order or blank lines as findings, in any story: the formatter owns that." (lasting: it says "in any story")
- `_story/rounds/01-story/receipts/0009-approve.json`, gate `sign-off`, round 1 (`01-story`), by the person: "Looks good, ship it." (this story only)

No ruling is delegated. Which of these do you read as a lasting preference? I read the first as lasting and the second as about this story only, and propose a line for the first:

### 1. Review never reports import order or blank lines

- **File**: `REVIEW.md` (new file: propose creating it; the repo has no `REVIEW.md`, and `AGENTS.md` has only a Commands section, so nothing states this yet)
- **Section**: Not findings (new heading)
- **Wording**: `- Never report import order or blank lines as findings, in any story: the formatter owns them.`
- **Ruling**: `_story/rounds/01-story/receipts/0005-reject.json` ("Never treat import order or blank lines as findings, in any story: the formatter owns that.")

## Went well

The single slice `01-export` went through implement in one attempt with no loops, asks or stuck reports (`01-export/receipts/0002-done.json`, `01-export/state.json`).

No file was changed; these are suggestions for you to apply or not.

## Working tree after

```
```
