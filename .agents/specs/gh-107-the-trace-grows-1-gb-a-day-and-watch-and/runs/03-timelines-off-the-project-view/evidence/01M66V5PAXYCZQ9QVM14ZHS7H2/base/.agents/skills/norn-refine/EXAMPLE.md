# Example spec

A short spec written to the standard of the refine skill, for an imagined card board. A real story usually has more Behaviour items; the point is their shape. Frontmatter is left out: refine keeps whatever is there.

```markdown
# Archive finished projects

## Problem
A team lead who has run a board for a year sees every project they ever made in the project picker,
finished ones included. Finding a live project means scrolling past dozens of dead ones, and new
members pick finished projects by mistake and file cards nobody will read.

## Solution
A project owner can archive a project. An archived project leaves the picker and the project list,
keeps all its cards readable, and can be restored. Nothing is deleted.

## Behaviour

- B1 As a project owner, I want to archive a project, so that it stops cluttering the picker.
  Example: owner opens "Website 2024" → Settings → Archive → confirms → the project is gone from the picker.
- B2 As a project owner, I want to be warned when the project still has open cards, so that I do not bury live work.
  Example: archiving a project with 3 open cards → "3 cards are still open. Archive anyway?" with Cancel as the default.
- B3 As a member, I want archived projects left out of the project list, so that I only see live ones.
  Example: the list shows 12 projects; after one is archived it shows 11.
- B4 As a member, I want to see archived projects on request, so that I can still find old work.
  Example: "Show archived" → the archived project appears, greyed, with "Archived 3 May by Ana".
- B5 As a member, I want an archived project's cards to stay readable but not editable, so that history is kept as it was.
  Example: opening a card in an archived project shows it with no Edit button and a banner "This project is archived".
- B6 As a member who follows a link to a card in an archived project, I want it to open, so that old links keep working.
  Example: a link from last year's chat opens the card with the archived banner.
- B7 As a project owner, I want to restore an archived project, so that I can undo a mistake.
  Example: "Show archived" → "Website 2024" → Restore → it is back in the picker with its cards editable.
- B8 As a member who is not the owner, I want no Archive action, so that I cannot archive a project by accident.
  Example: a member opens Settings of a project they do not own → there is no Archive button.
- B9 As a project owner, I want archiving to fail visibly when it cannot be saved, so that I know the project is still live.
  Example: the server is unreachable → "Could not archive. Try again." and the project stays in the picker.

## Out of scope
- Deleting projects — archiving is the reversible answer; deletion is its own story.
- Archiving automatically after inactivity — the owner decides; no rules engine.
- Archiving single cards — cards already have Closed.

## Open questions

- Q1 Should archived projects count against the plan's project limit? (bears on B1, B7)
  Options: count them / do not count them. Recommended: do not count them, because archiving is how teams make room.
  Who: Marta (billing)

## Plan
Written by the `norn-plan` skill.
```

What makes it work:

- Problem names who has it, when, and what it costs; it does not say "there is no archive button".
- Every Behaviour item is one observable behaviour with its own example. The warning (B2), the failure (B9) and the permission edge (B8) are items in their own right.
- Out of scope says why, so nobody builds deletion "while they are at it".
- The open question can be put to Marta as it stands: options, recommendation, and what it bears on.
- No file, table or function is named.
