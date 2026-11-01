## Summary

`norn status --watch` splits its one long list into three tabs (`1 Now`, `2 Backlog`, `3 Done`), lists each story once, reads closed stories as done, puts the story's title on NEEDS YOU rows and gives the list 60% of the width. The model's rows now carry a `tab`, and in-flight stories sort nearest to done first.

The `1 Now` tab, from the unit test's hand-built view at 150 columns (gh-1 and gh-2 wait for an approve, so they show only under NEEDS YOU):

```text
norn 0.15.0 · repo  3 need you                                                            tick 0s ago  12:00
 1 Now 3 need you · 2 in flight │ 2 Backlog 1 │ 3 Done 2
─────────────────────────────────────────────────────────────────────────────────────────────────────────────
NEEDS YOU 3                                                         │ gh-3 — Pick a CSV dialect
▸ ◆ gh-3  refine  Pick a CSV dialect                            30m │ ● parked at refine · auto · held here
  ● gh-1  ready   Pay invoices                                  30m │ …
  ● gh-2  ready   Ship the export                               30m │ ◆ ANSWER gh-3 · refine
IN FLIGHT 2                                                         │ answer instruction of gh-3
  gh-5  Bump the parser  parked ci · PR #9                          │
  gh-4  Rename the flag  running implement                          │
─────────────────────────────────────────────────────────────────────────────────────────────────────────────
enter orient · a answer · v trace · i issue · 1 2 3 tabs · / filter · ? keys · q quit
```

What the model (`cockpitModel`, CP2) changes:

```diff
 rows = needs-you items (tab: now)
-     + one row per story, by issue number
+     + one row per story with no needs-you item, sorted by tab:
+         now      in flight, fewest steps_left first, then issue number
+         backlog  not started, by issue number
+         done     story_status done or dropped (whatever the unit says), newest issue first
```

`steps_left` is a new `UnitView` field: the steps after the cursor, in the pinned workflow's step order.

## Evidence

The checks are tests. The quick workflow has no QA step, so nobody ran the cockpit in a real terminal. The new `packages/cli/test/unit/cockpit-tui.test.ts` builds a view by hand, turns it into the model and checks the rendered frame and the key handling. The implement step ran it red before the change and green after. The unit tier and the type check pass, and so does `packages/cli/test/integration/status-watch.test.ts` (19 pass).

- **Tabs with counts; `1 Now` is the default**
  **Before:** one list: NEEDS YOU, then every story by issue number.
  **After:** `frame(initial)` line 2 == ` 1 Now 3 need you · 2 in flight │ 2 Backlog 1 │ 3 Done 2 `. Pressing `2` or `3` shows `BACKLOG 1` or `DONE 2` (cockpit-tui test, view `cockpit.test.ts` tab/sort test).
- **A story that needs you shows once**
  **Before:** 14 of 21 STORIES rows repeated a NEEDS YOU row.
  **After:** `gh-1 ` appears exactly once in the frame, and no story row exists for a story with an item.
- **In flight sorts nearest to done first**
  **After:** gh-5 (1 step left) is listed above gh-4 (4 left). Steps are counted in the order the workflow declares them, so a workflow with loops gets only an approximate order (a review note, left for #136).
- **Done: closed stories, newest first, read done**
  **Before:** closed stories showed `not started · no slices · no PR`.
  **After:** gh-8 is listed above gh-7, and `gh-7 Closed before it ran done` reads done even though its unit never started. The preview shows `✓ done`, and the Done tab contains no `not started`.
- **A NEEDS YOU row shows the story's title**
  **Before:** it showed the item's instruction (`explore is ready (manual): start an a…`).
  **After:** `● gh-1  ready  Pay invoices  30m`, with no group word. The instruction stays in the preview.
- **List ~60%, preview ~40%**
  **Before:** a 40% list.
  **After:** the divider is at column `floor(150 × 0.6) + 1`, with the list at least 64 columns wide.
- **Section headers carry counts; `]` `[` `n`**
  **After:** the headers read `NEEDS YOU 3` and `IN FLIGHT 2`. `]` goes to `story:gh-5` and `]` `[` goes back to `answer:gh-3`. From approve gh-1, `n` goes to approve gh-2 and then wraps to gh-1. Past the last section the cockpit says `no next section`.
- **Each tab keeps its own selection and filter**
  **After:** filter `login` in Done, then `1`: Now has its selection back and no filter. `3` brings `login` back.
- **Less clutter**
  **After:** the frame has no `/ to filter` line. The filter shows first in the header while in use (`filter: login (esc clears)   norn 0.15.0`). Story rows show `no slices` and `no PR` only when the story has slices or a PR (`parked ci · PR #9`).
- **Version in the header**
  **After:** line 1 starts with `norn 0.15.0`. `status-watch` passes `NORN_VERSION` in.
- **Not shown:** how it looks in a real terminal with the 68-story fixture or the main checkout. To check, run `bun packages/cli/src/main.ts status --watch` in a throwaway repo, or try the committed prototype's variant `T` (`.agents/specs/gh-147-…/prototype/`; its imports carry the author's absolute paths).

`.agents/SPEC-cockpit.md` CP2, CP6 and CP7 are updated to match.

## Merge danger

**Door:** two-way: only a view model, the terminal renderer and docs change. No persisted format or receipt changes.

**Blast radius:** one screen: only people who use `norn status --watch` see it. Programs that read `status --watch --json` get a new `tab` field on each row, and story rows now come in a new order without the stories that have an item. Muscle memory for the old layout changes. `1` `2` `3` `]` `[` `n` are new keys, so no existing key changed.
