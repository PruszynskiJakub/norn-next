## Goal

Reproduce gh-273 (norn done adds a second Progress section when the handoff headings are level 3), confirm the cause and name the seam for a regression test. No fix.

## Progress

Reproduce findings (the same text as the issue comment; outputs indented):

**Reproduced** on `main` at 59a7b6a (0.25.0 + intake), through the CLI and with a minimal loop.

#### As a user (cli harness, real `norn brief` / `norn done` code path)

Throwaway test on `test/support/harness.ts` (one-step workflow, manual mode): tick until the unit is ready, `norn brief` in the worktree, write the handoff as `### Goal` / `### Progress` / `### Resume`, then `norn done done --handoff "x"`. The handoff afterwards:

    ### Goal
    
    Ship it.
    
    ### Progress
    
    - wrote the form
    
    ### Resume
    
    Run the tests.
    
    ## Progress
    
    - implement#1 done: x

Two Progress sections; norn's line lands after Resume. The repo shows the same in the wild: `.agents/specs/gh-267-reshape-the-bundled-and-repo-local/handoffs/_story.md` has `### Progress` (line 5) and a trailing `## Progress` (line 48).

#### Loop (deterministic, ~0.1 s, no spawn)

`bun loop.ts` from `packages/cli`: calls `appendProgress` (exported from `packages/cli/src/runtime/report.ts`) on a temp handoff whose three sections use heading level 1, 2, 3 and 4, and asserts exactly one Progress section with the new line right after the last milestone:

    #    Progress sections=2 RED
    ##   Progress sections=1 OK
    ###  Progress sections=2 RED
    #### Progress sections=2 RED
    exit=1

Minimised repro: a handoff `### Progress\n\n- a\n` and `appendProgress(file, "s#1 done: x")` → a new `## Progress` section is appended at the end of the file. Only the heading level matters; level 2 is the one that works.

#### Cause (confirmed)

`packages/cli/src/runtime/report.ts:94`: `appendProgress` finds the section with `/^##\s+Progress\s*$/`, which matches level 2 only; on no match (`:95-97`) it appends a fresh `## Progress` section at the end. The section end at `:99` (`/^##\s/`) is level-2-only too, so a fix that only widens the start regex would still run past `### Resume` to the end of the file; the end must be the next heading at the found section's level or higher (as `dropSection` in `packages/core/src/brief.ts:386-394` already does).

Where the `###` shape comes from: `handoffFor` in `packages/core/src/brief.ts:382` shows the handoff under Context through `demoteHeadings(text, 3)`, and agents write the file back in the shape they read. Knock-on: once a file holds both `###` and `##`, `demoteHeadings` shifts every heading by one (min level 2 → 3), so the agent's own sections show as `####` in the next brief.

Hypotheses ruled out by the loop: `handoffProse` / `writeHandoffBody` (`packages/store/src/unit.ts:164,190`) rewriting headings (level-2 input round-trips unchanged); the brief writing the file (it only renders; the file on disk keeps the agent's levels).

Callers that share the bug, all through `appendProgress`: `norn done` (`packages/cli/src/commands/done.ts:198`), gate rejections (`receiptsWritten`, `report.ts:86`) and checkout journaling (`packages/cli/src/runtime/checkout.ts:505`).

#### Rules

O6 (agents' milestones go into the handoff's Progress), S9 (the handoff holds only Goal / Progress / Resume; a second Progress breaks that shape).

#### Seam for the regression test

`appendProgress(handoffFile, line)` itself: a new unit test (`packages/cli/test/unit/report.test.ts`, fs only, allowed in the unit tier) over a temp handoff at heading levels 1–4: exactly one Progress section, the line appended after the last milestone and before the next section, the blank line kept. There is no unit test of `appendProgress` today; the only cover is `packages/cli/test/integration/agent-protocol.test.ts:261`, at level 2. One seam covers all three callers. Optionally extend the agent-protocol `done` test with a `###` handoff for the end-to-end path.

The loop script sits outside the repo (session scratchpad `loop.ts`). What it does: for each level from `#` to `####`, write `<lvl> Goal / <lvl> Progress (- wrote the form) / <lvl> Resume` to a temp file, call `appendProgress(f, "implement#1 done: x")`, count `/^#+\s+Progress\s*$/gm` and check that the line follows `- wrote the form`.

## Resume

Post the findings above as the `## Reproduce` comment on issue 273 (the permission classifier blocked `gh issue comment` in the first session), then report `norn done reproduced`.
