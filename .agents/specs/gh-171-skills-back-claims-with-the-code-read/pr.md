## Summary

Agents running the bundled skills now carry three rules that target the rework seen in gh-64: back code/config claims with the usages that consume them, read existing test helpers before writing a test, and state how a terse answer was read instead of asking again.

```text
packages/cli/assets/skills/
  norn-triage/     + back claims with consuming file:line usages; name keys defined but never read
                   ~ "Affected code" line: read at the usage that consumes it
  norn-refine/     + back your own claims with the code
                   + read a terse answer out loud
  norn-implement/  ~ Read step: helpers, fixtures, fakes and the real state shape before a test
  norn-tdd/        + loop rule: read before you write the test
  norn-interview/  + terse answer → one-line "Read as: …", then carry on
  norn-clarify/    ~ same terse-answer rule when folding answers in
```

## Evidence

The `quick` workflow has no QA step, so nothing was observed running; each rule is shown by the text it adds.

- **Rule 1 — back claims with the code** (`norn-triage`, `norn-refine`)
  **Before:** triage said "read them"; refine cross-checked only the person's claims, not its own.
  **After:** both say to find the `file:line` usages that consume a key, never infer behaviour from a schema, type or docs alone, and name a key as "defined but never read".
- **Rule 2 — read test helpers first** (`norn-implement`, `norn-tdd`)
  **Before:** no instruction to read existing helpers, fixtures or fakes before a test.
  **After:** implement's Read step and a new tdd loop rule say to read the helpers, fixtures and fakes at the seam and the real shape of the asserted state, and reuse them.
- **Rule 3 — state how a terse answer was read** (`norn-interview`, `norn-refine`, `norn-clarify`)
  **Before:** did not exist.
  **After:** all three say to state the reading in one line ("Read as: drop B3 and B4, keep B5.") and carry on; the person corrects it.
- **No regressions:** docs-only diff; unit tier 1103/0 and typecheck clean; integration tier 604/0 on rerun (an earlier run's 5 timeouts in `criteria.test.ts` and `check-run.test.ts` touch none of these files). Whether agents actually follow the rules shows only in later runs.

## Merge danger

**Door:** two-way: prose in skill sources; a revert restores it, and `norn init` rewrites the copies in each repo.

**Blast radius:** agent steps: agents in later releases read these skills; worst case a slightly longer read before a test or a misread terse answer the person has to correct.
