---
name: norn-slice
description: Break a planned spec into tracer-bullet slice files, each with its dependencies, acceptance criteria citing Behaviour numbers (also listed as frontmatter `criteria` with verifier and needs), check commands and a verifier per criterion. Use when asked to slice, split or break a planned spec into deliverable pieces.
---

# Slice

Cut the plan into slices a person can judge at a glance: the slice files you write are what they review before any slice starts.

1. Read the spec, its Plan included, and explore the code it touches.
2. **Draft tracer bullets.** Break the work into slices. Each slice:
   - cuts a narrow but complete path through every layer it touches, tests included: vertical, never one layer;
   - is verifiable on its own and leaves the codebase green;
   - fits one fresh context window;
   - names the Behaviour items it makes work.

   The Plan's prefactoring goes first. Give each slice its **dependencies**: the slices that must land before it can start. Slices with no dependencies run in parallel, so keep an edge only where one slice genuinely gates another.

   **Wide refactors are the exception.** A single mechanical change whose blast radius fans across the codebase (rename a column, retype a shared symbol) cannot land green as one vertical slice. Sequence it as **expand–contract**: expand (add the new form beside the old), then migrate call sites in batches sized by blast radius, each depending on the expand, then contract (delete the old form) depending on every batch.
3. **Verifiers.** Every criterion gets one: `test` when an automated test proves it, `agent` when it is checked by using the software, `person` when it needs human judgement or access (visual design, a real payment, a third-party console). An agent checks every slice from the user's side; use `person` sparingly, and say why in the criterion. That reason is all a person checks.
4. **Check the breakdown** before writing files: every Behaviour item covered, every edge real, nothing that should merge or split. If a call is genuinely the person's (two equally good cuts, a slice far bigger than the plan suggests), say so in that slice's Notes rather than guessing silently.
5. **Write** the slice files in dependency order, so the slices a file depends on exist before it, each in the layout below. Then hand back a numbered overview, one line per slice: title, verifiers, depends on, and what it delivers end to end.

Done when every Behaviour item is cited by some acceptance criterion; each slice file has valid frontmatter (with `criteria` matching its Acceptance section id for id), a goal, acceptance with verifiers, and checks; and `depends_on` forms no cycle and names only existing slices.

## Slice file

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
One or two lines: what changes for the user when this lands, end to end.

## Scope
Behaviour: B3, B4. Seams: S2. Out: anything another slice covers.

## Acceptance
- AC1 (B3) Given <context>, when <action>, then <observable effect>. — verifier: test
- AC2 (B4) … — verifier: agent (needs: browser)
- AC3 (B4) … — verifier: person, because <what only a person can check, and why>

## Checks
- `bun test packages/invites`

## Notes
Pointers to plan decisions (D1), traps, and any call left for the person.
```

## Rules

- Never renumber or rename existing slice files; their keys are permanent. Append new numbers.
- Every acceptance criterion cites the Behaviour item(s) it proves and is observable at an agreed seam, not a code detail.
- **Frontmatter `criteria`** repeats the Acceptance section as data: one `{ id, verifier }` per item, the same ids in the same order, nothing more and nothing less. Whoever verifies the slice gives one verdict per id listed here, so a criterion missing from the list is never checked.
- **`needs`** names what checking a criterion takes beyond a shell: `browser` for anything seen in a web page, or e.g. `device`, `email`. Omit it when a terminal is enough. It lets a criterion that could not be checked be traced to the missing capability.
- When the story spec itself has acceptance criteria checked across slices (story-level verification), add the same `criteria` list to the story file's frontmatter, with the ids its Behaviour or acceptance items use; leave every other frontmatter field as it is.
- Checks are commands that run in the repository and exit non-zero on failure.
- Behaviour and interfaces, not file paths: the slice may wait while the code moves.
