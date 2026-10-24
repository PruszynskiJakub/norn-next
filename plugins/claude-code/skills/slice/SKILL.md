---
name: slice
description: Cut a plan into slice files — small, independently buildable units, each with frontmatter, dependencies, acceptance criteria citing Behaviour numbers (also listed as frontmatter `criteria` with verifier and needs), check commands and a verifier per criterion. Use when asked to slice, split or break a planned spec into deliverable pieces.
---

# Slice

Cut the plan into slices: each one small enough to build and review in one sitting, and complete enough to verify on its own.

## Cutting

- **Vertical, not layered.** A slice delivers observable behaviour end to end (or a prefactoring), not "all the models" then "all the handlers".
- Prefactoring from the plan becomes the first slice(s), so later slices start from clean ground.
- Each Behaviour item is covered by at least one slice's acceptance. Avoid splitting one Behaviour item across slices unless it is large.
- Order by dependency. Make slices independent where you can, so they can run in parallel; add a dependency only when one slice truly needs another's code.
- Aim for slices of roughly half a day of work. Split larger ones.

## File format

One file per slice: `slices/<nn>-<slug>.md` next to the spec, `nn` two digits from `01`, slug short kebab-case. The id is the story key from the spec's frontmatter `id` plus `/<nn>`.

```markdown
---
id: gh-123/02
title: Reject expired invites
workflow: slice           # optional; omit for the default, set only if the plan calls for another
depends_on: [gh-123/01]   # full slice keys of the same story; [] when none
status: planned
criteria:                 # one entry per Acceptance item below, same ids and verifiers
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: agent, needs: [browser] }
  - { id: AC3, verifier: person }
---

## Goal
One or two lines: what changes for the user when this lands.

## Scope
Behaviour: B3, B4. Seams: S2. Out: anything another slice covers.

## Acceptance
- AC1 (B3) Given <context>, when <action>, then <observable effect>. — verifier: test
- AC2 (B4) … — verifier: agent (needs: browser)
- AC3 (B4) … — verifier: person

## Checks
- `bun test packages/invites`

## Notes
Pointers to plan decisions (D1), files to touch, traps.
```

## Rules

- Never renumber or rename existing slice files; their keys are permanent. Append new numbers.
- Every acceptance criterion cites the Behaviour item(s) it proves and is observable, not a code detail.
- **Verifier** says who can confirm a criterion: `test` (an automated test proves it), `agent` (checked by using the software), `person` (needs human judgement or access, e.g. visual design, real payment, third-party console). Use `person` sparingly and say why.
- **Frontmatter `criteria`** repeats the Acceptance section as data: one `{ id, verifier }` per item, the same ids in the same order, nothing more and nothing less. Whoever verifies the slice reports one verdict per id listed here, so a criterion missing from the list is never checked.
- **`needs`** names what checking a criterion takes beyond a shell: `browser` for anything seen in a web page, or e.g. `device`, `email`. Omit it when a terminal is enough. It lets a criterion that could not be checked be traced to the missing capability.
- When the story spec itself has acceptance criteria checked across slices (story-level verification), add the same `criteria` list to the story file's frontmatter, with the ids its Behaviour or acceptance items use; leave every other frontmatter field as it is.
- Checks are commands that run in the repository and exit non-zero on failure.

## Finished when

Every Behaviour item is cited by some acceptance criterion; each slice file has valid frontmatter (with `criteria` matching its Acceptance section id for id), a goal, acceptance with verifiers, and checks; `depends_on` forms no cycle and names only existing slices.
