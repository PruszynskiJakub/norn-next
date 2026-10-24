---
name: implement
description: Build a slice or story test-first — red, green, one behaviour at a time, through public seams — and fix rework points (failing checks, review findings, QA repros) as red tests first. Use when asked to implement, build, fix or rework code against acceptance criteria, or when TDD / test-first is requested.
---

# Implement

Make every acceptance criterion true, each proven by a test that failed before the code existed.

## Before you start

1. Read the acceptance criteria, the spec items they cite, and the plan's seams for them.
2. **If there is a Rework section** (failing check output, review findings, a QA repro), it comes first. Each point becomes a red test before you touch code:
   - failing check: reproduce the failure locally and read the full output;
   - review finding: write the test that exposes the problem;
   - QA failure: turn the repro into a test that fails the same way.
   Then continue with any criteria not yet covered.
3. Run the existing tests once so you know the baseline.

## The loop: one behaviour at a time

1. **Red.** Write one test for the next behaviour, through the seam's public interface. Run it; watch it fail for the right reason (an assertion, not a typo or import error).
2. **Green.** Write the least code that makes it pass. Run it, then the related tests.
3. **Tidy.** With everything green, remove duplication and improve names. Behaviour-preserving changes only; run tests after each.
4. Repeat with the next behaviour. Never write code for a behaviour that has no failing test yet.

## Tests

- Test behaviour, not implementation: assert what a caller observes, through public interfaces only. A refactor that keeps behaviour must keep tests green.
- One reason to fail per test; name it after the behaviour (`rejects an expired invite`).
- **Mock only at system boundaries**: network, clock, randomness, third-party services, sometimes the filesystem. Prefer simple fakes over mocking libraries. Never mock your own modules.
- Keep tests fast and deterministic: no sleeps, no real network, no shared mutable fixtures.
- Follow the repository's existing test layout and helpers.

## Rules

- Stay inside the acceptance criteria and rework points. Note anything else you spot instead of changing it.
- Follow the repository's conventions (contributor docs, linters, type checks).
- If a criterion is ambiguous or contradicts the code, stop and say what decision is needed rather than guessing.

## Finished when

Every acceptance criterion and every rework point has a test that passes and would fail without the change; the full test suite, type check and linters pass; no unrelated changes remain in the diff.
