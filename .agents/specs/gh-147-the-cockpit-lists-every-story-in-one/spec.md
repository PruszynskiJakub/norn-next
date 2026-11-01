---
id: gh-147
slug: the-cockpit-lists-every-story-in-one
provider: gh
number: 147
url: https://github.com/PruszynskiJakub/norn-next/issues/147
title: "The cockpit lists every story in one long list: needs-you stories show twice, closed ones look not started, rows are cut off"
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:quick
workflow: quick
status: active
intake_at: 2026-11-01T17:43:39.482Z
body_hash: d6f21d0249dc676f1c3559d1a76c5e76fccedfc583ed9ac0571401275675ef45
---

## Observed

`norn status --watch` on `main`, with 17 items needing the person and 30+ stories:

- **STORIES is mostly repeats and history.** Of 21 STORIES rows, 14 repeat a NEEDS YOU row and 6 are done;
  2 add anything. Rows sort by issue number, so active stories sit among closed ones.
- **Closed stories read "not started".** `storySummary` reads `unit.status` only; on the main checkout
  19 closed stories show `not started · no slices · no PR`.
- **A NEEDS YOU row never says what the story is.** It shows the item's instruction
  ("explore is ready (manual): start an a…"), which repeats the step and reads the same on 8 rows.
- **The list is cramped, the preview mostly empty.** The list has 40% of the width: item text is cut at
  ~25 chars, titles at 28; the preview uses ~12 of 40 lines.
- **A long list has no way around it** but moving the selection or `/`: no section counts, no jump keys.
- **Clutter:** the "/ to filter" line, the group word next to its mark, "no slices · no PR" on most rows.

## Wanted

The cockpit in tabs, by how often the person goes there:

- **`1 Now`** (default): NEEDS YOU, then IN FLIGHT (sorted nearest to done first). A story that needs you
  shows once, under NEEDS YOU, whatever its phase.
- **`2 Backlog`**: stories not started, with `t take`. Visited now and then.
- **`3 Done`**: closed stories (`story_status: done`), newest first. Visited rarely.

The tab strip carries counts (`1 Now 23 need you · 8 in flight │ 2 Backlog 2 │ 3 Done 35`); the header still
counts what needs you across the repo; each tab keeps its own selection and filter. In every tab:

- A NEEDS YOU row shows the story's title; the item's instruction stays in the preview.
- A closed story reads as done (`story_status`), never `not started`.
- The list takes ~60% of the width, the preview ~40%.
- Section headers carry counts; `]` / `[` jump between sections, `n` goes to the next row of the same kind
  (e.g. the next approve).
- No "/ to filter" line (the filter shows in the header while in use); the mark without the group word;
  "no slices" / "no PR" only shown when there are slices or a PR.
- The header shows the running norn's version (`norn 0.15.0`, from `NORN_VERSION`). A long-running cockpit
  keeps its binary's version after a new release is installed, so the header shows which one is open.
  When the repo pins a version (#61), a mismatch shows there too; that is #61's to add.

Stage stays shown as today (`<status> <step>`) until #136 settles legs.

Out of scope:
- How a story's stage is shown (a step count in one workflow, or a chain of legs) and a new layout for the
  Now tab: both depend on #71 and #136, where a story goes through several legs and a story between legs
  waits for the person. A note on #136 holds what the prototype showed about that.
- Model fields the tabs would like: `closed_at` (Done sorts by issue number until then), a time-in-step.

## Prototype

Throwaway TUI prototype on the real `CockpitModel` (`norn status --watch --json`) and a 68-story fixture:
https://gist.github.com/PruszynskiJakub/55109f58b7bf309b7310a041f4b086eb (its README says how to run it).
Variant `T` is the verdict (tabs, every fix on); variant `0+` puts each fix behind a number key against
today's layout. `bun serve.ts` opens it in the browser (xterm.js), `bun run.ts --variant T` in the terminal.
Verdict: tabs, with the fixes above; three new layouts (phase board, one-row stage track, views) were tried
and rejected in favour of improving today's layout. Commit it next to the spec as the record (norn-prototype).

Seen while prototyping, not part of this issue: on the main checkout gh-124, gh-125 and gh-126 are stuck
but no NEEDS YOU item lists them.

## Where

- `packages/cli/src/runtime/cockpit-tui.ts:371` `renderCockpit`: header and filter line (:384), item row
  text (:402), sections (:408); `storySummary` (:336); `layout`'s list width (:351); `handleKey` (:122) for
  the tab, section and `n` keys.
- `packages/view/src/cockpit.ts:136`: story rows: built for every story, including those with an item.
- `packages/cli/src/version.ts`: `NORN_VERSION`, for the header.

## PRD

O1 (the cockpit groups by action). `.agents/SPEC-cockpit.md` CP2 (the model's rows) and CP6 (layout, 40%
list) change; CP7 (keys) gains the tab, section and `n` keys.

