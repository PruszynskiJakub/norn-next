---
id: gh-301/10
title: norn-retro proposes lasting preferences from gate rulings
depends_on: []
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: agent }
---

## Goal
A retro lists the story's gate rulings, asks which read as a lasting preference, and proposes for each a line for `REVIEW.md` or the repo's agent instructions file, naming the file, section, wording and ruling, while still changing no file.

## Scope
User stories: lists gate rulings and asks which last; a `REVIEW.md` line for a ruling on how code is judged; an agent instructions file line for a ruling on how agents work; each proposal names file, section, wording and ruling; a missing target file is proposed for creation; an already-stated preference is cited, not duplicated; `norn-retro` still changes no file. Seams: S5. Decision D16. Out: any change to how rulings are recorded.

## Acceptance
- AC1 Given the `norn-retro` source, then after the friction it has a section that lists the story's gate rulings (`approve` and `reject` comments with gate, round and the person's words, delegated ones marked) and asks which read as a lasting preference, pinned by terms in the assets test. — verifier: test
- AC2 Given the `norn-retro` source, then it proposes a `REVIEW.md` line for a ruling on how code is judged and a line for `AGENTS.md` (else `CLAUDE.md`) for a ruling on how agents work, each naming the file, section, wording and source ruling, pinned by terms. — verifier: test
- AC3 Given the `norn-retro` source, then it still says it changes no file (the existing pin kept). — verifier: test
- AC4 Given a finished story with a gate ruling that reads as lasting, when an agent runs the retro on it in a repo lacking the target file and again where the file already states the preference, then the first proposes creating the file with that line and the second cites the existing line as evidence instead of proposing a duplicate. — verifier: agent

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
Edit at `packages/cli/assets/skills/norn-retro/`. The Plan put the missing-file and duplicate cases at review; AC4 makes them an agent check so QA gives them a verdict.
