---
name: refine
description: Turn a story (an issue's title and body) into a testable spec — numbered Behaviour items, edge checklist, out of scope, open questions. Use when asked to refine, spec out, or write requirements for an issue or story before planning.
---

# Refine

Turn a raw story into a spec a planner and a tester can work from without asking you anything.

## Process

1. Read the story text, linked material, and the parts of the codebase it touches. Learn the current behaviour before describing the new one.
2. If a person is with you, settle the big unknowns with them one question per turn, each with your recommended answer. Settle anything the code can answer yourself.
3. Write the spec in place of (or below) the story text. Keep any frontmatter unchanged.

## Spec format

```markdown
## Context
Why this matters and for whom, in a few lines. Current behaviour, if changing it.

## Behaviour
- B1 When <trigger/situation>, <actor> sees/gets <observable effect>.
- B2 …

## Edge checklist
- [ ] Empty / missing input — <expected behaviour or "n/a: why">
- [ ] Invalid / malformed input
- [ ] Limits and size (zero, one, many, max)
- [ ] Concurrency / repeated action / retry
- [ ] Failure of a dependency (network, disk, external service)
- [ ] Permissions / who may do it
- [ ] Backwards compatibility and existing data

## Out of scope
- What this story does not do, and anything deliberately deferred.

## Open questions
- Q1 <question> — options: <a> / <b>; recommended: <a> because <reason>.
```

## Rules

- **Behaviour items are observable.** Each says what a user or caller sees, not how the code does it. One behaviour per item; testable as written.
- Number Behaviour items `B1…` and never renumber once others may cite them; append new ones, strike removed ones.
- Every edge line gets an expected behaviour (often a new B item) or an explicit "n/a" with the reason.
- Prefer a decision with a stated assumption over an open question when the stakes are low; mark it "(assumed)".
- No implementation design: modules, data structures and file names belong to planning.

## Finished when

The spec has Context, numbered Behaviour, a filled edge checklist and Out of scope. Open questions is either empty, or every remaining question is listed with options and a recommendation.
