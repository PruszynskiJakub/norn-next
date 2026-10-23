---
name: plan
description: Design how a spec gets built — seams, a coverage table mapping every Behaviour item to a seam, prefactoring, and decisions — following deep-module, small-interface codebase design. Use when asked to plan, design or architect the implementation of a spec.
---

# Plan

Decide where the new behaviour lives and how it will be tested, before anyone writes code.

## Process

1. Read the spec and the code around every Behaviour item. Find existing modules, patterns and tests to build on.
2. Choose the seams. Discuss the decisions that matter with the person when one is present, one question per turn, with your recommendation.
3. Write the plan document.

## Codebase design

- **Deep modules, small interfaces.** A module earns its place by hiding a lot behind a little. Prefer few, simple entry points over many thin pass-throughs.
- **Hide decisions likely to change** (formats, providers, storage) behind one module each.
- **Test at seams, not internals.** A seam is a public interface where a behaviour can be observed and a dependency can be substituted. Tests that touch internals block refactoring.
- **Pull side effects to the edges**; keep decision logic pure where possible.
- **Follow the codebase's existing patterns** unless the plan says why not.
- Name things in the domain's words, the same words the spec uses.

## Plan format

```markdown
## Seams
- S1 `<module or interface>` — what it hides; its interface in one or two signatures; where its tests live.

## Coverage
| Behaviour | Seam | Test kind (unit / integration / e2e) | Notes |
|---|---|---|---|
| B1 | S1 | unit | |

## Prefactoring
- P1 Behaviour-preserving change that makes the new work easy (move, extract, rename). Done first, with tests green.

## Decisions
- D1 <decision> — options considered; chosen because <reason>; consequence.

## Risks
- What could make this plan wrong, and how we would notice early.
```

## Finished when

Every Behaviour item appears in the coverage table with a seam and a test kind; each seam has a stated interface; prefactoring is listed (or "none"); every non-obvious choice is in Decisions; the person, if present, agrees.
