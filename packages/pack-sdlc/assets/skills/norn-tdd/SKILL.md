---
name: norn-tdd
description: Reference for building code test-first — red → green one behaviour at a time, tests only at agreed seams, none of the usual test anti-patterns. Use for TDD or test-first work, or when another skill builds code test-first. Not for a failure that won't reproduce; use norn-diagnose.
---

# Test-driven development

Without these rules, tests get written in bulk, against internals, or with expected values copied from the code: they pass by construction and break on every refactor. They apply on every red → green cycle.

## Seams: where tests go

A **seam** is where a module's interface lives: you observe behaviour through that interface, without reaching inside. Tests go only at agreed seams, never against internals.

- **Agreed means written down before the first test:** a plan's Seams section, or seams you wrote down and the person confirmed.
- **No person present:** use the highest existing seam that observes the behaviour (where the criterion or repro is phrased: the command, the request, the screen) and say so when you hand back. If no existing seam observes it, stop and say which seam needs agreeing.
- Agreeing seams up front puts the testing effort on the critical paths and complex logic, not on every edge case.
- When the interface's shape is itself in question (how deep the module is, where the seam belongs, what it exposes), consult the `norn-codebase-design` skill for the vocabulary. It is a reference, not a session to run.

## The loop

1. **Read before you write the test.** Read the existing test helpers, fixtures and fakes at the seam, and the shape of the state or output you assert on as the code produces it, not as you expect it. Reuse what is there; a guessed helper, prefix or field makes the test fail for the wrong reason. Name the test in the project's domain words (its glossary or `CONTEXT.md`, if it has one), and respect the recorded decisions (ADRs) in the area.
2. **Red.** One test for one behaviour. Run it and watch it fail for the right reason: an assertion, not a typo or an import error. A test that passes before the code exists proves nothing: either the behaviour is already there or the test misses it; find out which before going on.
3. **Green.** Write only enough code to pass it. No code for a later test, no speculative features.
4. **Next behaviour.** Each test is a tracer bullet that answers to what the last cycle taught you.

Refactoring is not part of the loop. It belongs to the review pass after the last green (see the `norn-implement` skill).

## Anti-patterns

- **Implementation-coupled:** mocks internal collaborators, tests private methods, or verifies through a side channel (querying the database instead of using the interface). The tell: it breaks on a refactor that keeps behaviour. Mock only at system boundaries ([mocking.md](mocking.md)).
- **Tautological:** the assertion recomputes the expected value the way the code does (`expect(add(a, b)).toBe(a + b)`, a snapshot derived the same way, a constant asserted equal to itself), so it can never disagree with the code. Expected values come from an independent source: a known-good literal, a worked example, the spec.
- **Horizontal slicing:** all tests first, then all code. Bulk tests check imagined behaviour and the shape of things, and fix the test structure before you understand the code.

Examples of each: [tests.md](tests.md).

Done when every behaviour you set out to build has a test at an agreed seam that failed first and passes now.
