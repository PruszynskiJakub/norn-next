---
name: norn-plan
description: Agree with the person how a refined spec gets built — test seams, prefactoring, decisions, risks — and write the spec's Plan section, mapping every user story to a seam. Use when asked to plan a spec or story before it is sliced or built.
---

# Plan

The plan is what implementation builds to: it writes tests only at the agreed seams and treats every decision here as settled. Anything left vague is decided later, by an agent, without the person.

**No person with you** (an unattended run): write the plan with your recommendations, mark every seam and decision **(proposed)**, build no prototype or spike, and stop, saying which of them need a person's agreement before anyone builds to them. A proposed plan is never "ready to build to".

**A Plan is already there** (a replan round): the handoff says what no longer holds. Check the rest against the code on this base too, revise the section in place, and keep the ids (S1, D1, …) of what still holds.

## 1. Explore

Read the whole spec, then map it onto the code.

- **Where each user story lives**: the module that does that work today, or the nearest one that will. Stories that land in one module usually share a seam.
- **The tests already there**: which interface they drive, their helpers, fixtures and fakes. That is the prior art to copy, and it shows which seams exist.
- **The constraints**: the decision records and the glossary in the area. A decision record holds unless the person chooses to revisit it; say when the story cuts across one.
- **The friction**: logic spread over several callers, an interface as wide as its body, a missing seam that would force tests onto internals, a name that disagrees with the glossary.

## 2. Seams

- Prefer an existing seam to a new one, and the highest seam that observes the behaviour: the one closest to what the user does. A test there survives refactors below it. The fewer seams the better; the ideal is one.
- Too low: the test must reach past the interface to check the result, or would mock the project's own modules. Move it up.
- Too high: it cannot observe the result without a real network, clock or person. Keep the seam and fake only that boundary.

Every user story goes in the coverage table under exactly one seam, with a test kind. A story with no seam is a gap: close it with a seam, or take it to the person (part 5). A story no test can observe (a docs or skill-text change, a judgment only a person makes) still gets a row: name the check that observes it (a lint, review, QA by a person).

When a module's interface or a seam's placement is itself in question, invoke the `norn-codebase-design` skill. When a new interface is central to the story, offer to design it twice ([DESIGN-IT-TWICE.md](../norn-codebase-design/DESIGN-IT-TWICE.md)) and recommend one.

## 3. Prefactor

Make the change easy, then make the easy change; slicing puts prefactors first. Each one changes no behaviour, lands green on its own, and earns its place for this story, not for tidiness: say which user stories it makes easier, and how. Typical: extract the module the story will grow, deepen an interface the story would widen, add the seam the tests need, rename to the glossary's term before the story spreads the old one. "None" is a fine answer; do not invent one.

## 4. Decide

List what the code does not settle and implementation will need: interface, schema and file-format changes, contracts with other systems, error handling, migration of existing data or configuration, anything costly to change once shipped. Each gets a recommendation and its reason.

Name the risks: the part most likely to go wrong, or not known to work. A question only trying can answer (does the library do X, is it fast enough) gets a spike before the plan is agreed, not a guess in it. A decision that turns on look and feel, or on a state model hard to judge on paper: offer the `norn-prototype` skill; its verdict is the decision.

Offer a decision record only when a decision is hard to reverse, surprising without its context, and the result of a real trade-off: all three.

## 5. Interview

Invoke the `norn-interview` skill to agree, in this order: the seams with the coverage table, the prefactoring, then each decision.

A user story that is ambiguous, contradicts another, or costs far more than the person may expect goes to them; do not plan around it. With their agreement, amend the story in the spec, keeping its number: slices, criteria and review cite it, so never renumber. If it needs someone not present, it becomes an open question again and the plan waits.

## 6. Write the Plan

Write the `## Plan` section in the layout below. Touch nothing above it except the stories the person agreed to amend.

Name modules, interfaces and existing tests by name, never by file path, and put no code in it: the plan outlives refactors. Leave out the order of work too: slicing decides it. The one exception is a prototype snippet that encodes a decision more precisely than prose (a state machine, a schema, a type shape): inline its decision-rich part and say it came from a prototype.

Before you hand back, read it as implementation will: no decision says "to be decided"; what may be faked is only a system boundary; every seam names its prior art or says there is none.

Done when every user story is observable at an agreed seam and the person agrees the plan; with no person present, when the plan is written with every seam and decision marked proposed.

## Plan layout

```markdown
## Plan

### Seams
- **S1 <module>, through <its interface>.** Observes US1–US4, US7.
  Prior art: <the existing tests in this area that drive the same interface>.

### Coverage
| User story | Seam | Test kind (unit / integration / e2e) | Notes |
|---|---|---|---|
| US1 an expired invite is rejected | S1 | integration | |

### Prefactoring
1. <the change> — <what it makes easier, for which user stories>

### Implementation decisions
- D1 <decision> — <why, and the alternative it beat when that matters>

### Testing decisions
What a good test means here (external behaviour through the seam, never internals),
which modules are tested, and what sits at a system boundary and may be faked.

### Risks
What is most likely to go wrong or is not yet known to work, and how the slices meet it early.
```
