---
name: norn-implement
description: Builds a slice or story test-first at the seams its plan agreed, or works through rework points, then reviews its own diff before handing back. Use when asked to implement, build or rework code against acceptance criteria or review findings.
---

# Implement

Without this, code lands before its test, rework gets patched without a test that saw it fail, and the diff carries more than was asked. Make every behaviour change true, each proven by a test that failed before the code existed.

1. **Read.** The acceptance criteria, the spec items they cite, and the spec's Plan, its Seams and Testing decisions above all. With no Plan (a quick round), work from the issue and its latest `## Triage` or `## Reproduce` comment. Run the existing tests once for a baseline. Then read only the code the work touches, as you reach it: no tour of the repository.
2. **Rework first.** Rework points (failing check output, review findings, a QA repro, a person's rejection at a gate) come before anything else, each a test made red before you touch code:
   - failing check: reproduce it locally and read the full output;
   - review finding or rejection: write the test that exposes it;
   - QA failure: turn its repro into a test that fails the same way.

   A finding no test can show (a name, a smell, a doc) is fixed directly, the suite staying green. When a failing check or a repro does not fail for you on the first try (flaky, CI-only, timing), invoke `norn-diagnose` and get a loop that goes red before the red test; never fix a failure you have not seen fail. Then go on with criteria not yet covered.
3. **Build test-first.** Invoke `norn-tdd` and work red → green, one tracer bullet at a time. The Plan's seams are the pre-agreed seams `norn-tdd` asks for; when a behaviour cannot be observed at any of them, use the highest existing seam that does and say so when you hand back. A docs change or a pure refactor needs no new test, only a green suite.
4. Run the type check and the repo's fast suite after each change. Slower tiers (integration, end-to-end) run in their own check; do not run them before handing back.
5. **Review pass.** Read your whole diff as review will: every criterion or rework point met and nothing beyond it, the repo's documented standards, and the smells in [`norn-review`'s SMELLS.md](../norn-review/SMELLS.md). Refactor here, not inside the loop, the suite green after each change.

## Rules

- Stay inside the criteria and rework points. Note anything else you spot instead of changing it.
- If a criterion is ambiguous or contradicts the code, stop and name the decision needed rather than guessing.
- Commit locally; never push.

Done when every behaviour change (criterion or rework point) has a passing test at an agreed seam that would fail without it, the type check, linters and fast suite are green (slower tiers run in their own check), the work is committed, and the diff holds nothing unrelated.
