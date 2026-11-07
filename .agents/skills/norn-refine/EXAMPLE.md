# Example spec

A short spec written to the standard of the refine skill, for an imagined card board. A real story usually has more user stories; the point is their shape. Frontmatter is left out: refine keeps whatever is there.

```markdown
# Archive finished projects

## Problem Statement
A team lead who has run a board for a year sees every project they ever made in the project picker,
finished ones included. Finding a live project means scrolling past dozens of dead ones, and new
members pick finished projects by mistake and file cards nobody will read.

## Solution
A project owner can archive a project. An archived project leaves the picker and the project list,
keeps all its cards readable, and can be restored. Nothing is deleted.

## User Stories

1. As a project owner, I want to archive a project from its Settings, so that it stops cluttering the picker.
2. As a project owner, I want to be warned when the project still has open cards, so that I do not bury live work.
   Example: 3 open cards → "3 cards are still open. Archive anyway?" with Cancel as the default.
3. As a member, I want archived projects left out of the project list, so that I only see live ones.
4. As a member, I want a "Show archived" switch that lists archived projects greyed, with who archived them and when, so that I can still find old work.
5. As a member, I want an archived project's cards to stay readable but not editable, with a banner saying the project is archived, so that history is kept as it was.
6. As a member who follows an old link to a card in an archived project, I want it to open, so that old links keep working.
7. As a project owner, I want to restore an archived project, so that I can undo a mistake.
8. As a member who is not the owner, I want no Archive action, so that I cannot archive a project by accident.
9. As a project owner, I want archiving to fail visibly when it cannot be saved, so that I know the project is still live.
   Example: the server is unreachable → "Could not archive. Try again." and the project stays in the picker.

## Out of Scope
- Deleting projects — archiving is the reversible answer; deletion is its own story.
- Archiving automatically after inactivity — the owner decides; no rules engine.
- Archiving single cards — cards already have Closed.

## Further Notes
Billing counts projects per plan; the open question below decides whether archived ones count.

## Open questions

1. Should archived projects count against the plan's project limit? (bears on archiving and restoring)
   Options: count them / do not count them. Recommended: do not count them, because archiving is how teams make room.
   Who: Marta (billing)

## Plan
Written by the `norn-plan` skill.
```

What makes it work:

- The Problem Statement names who has it, when, and what it costs; it does not say "there is no archive button".
- Every user story is one observable behaviour, concrete enough to check. The warning, the failure and the permission edge are stories in their own right.
- Only two stories carry an example: the ones where an exact message is the decision.
- Out of Scope says why, so nobody builds deletion "while they are at it".
- The open question can be put to Marta as it stands: options, recommendation, and what it bears on, in words.
- No file, table or function is named.
