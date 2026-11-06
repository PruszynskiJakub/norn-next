## Summary

Applies the skill-shaper proposals, skill text only, to the 20 bundled skills and the repo-local `issue`, `release` and `release-start`. Agents get shorter skills with sharper descriptions, and a rule that was in two skills now lives only in the one the others invoke. No code changes.

```
packages/cli/assets/skills/<20 skills>/   # source rewritten from the proposals (+ codebase-design, prototype, tdd reference files)
.agents/skills/norn*/                     # copies refreshed from source (norn-fsd-round's copy was stale)
.agents/skills/{issue,release,release-start}/  # repo-local, edited in place
```

The proposals were treated as drafts. Where one broke a lint or contradicted the code, the old text won:
- The craft skills still name no norn words (P7). Rule ids the merge and pr proposals cited were dropped.
- norn-fsd-round keeps its pinned phrases, and norn-implement keeps "fast suite after each change" (AC4).
- norn-slice no longer claims a check step runs slice `checks`, because nothing reads them.

## Evidence

No QA ran. These entries come from the lint tests, `diff`s and the review's traceability table. `bun run test` and `bun run typecheck` pass (test#2).

- **W1** 20 bundled skills applied
  **After:** 10 match their proposals exactly. The other 10 differ only where `assets.test.ts` (P7, fsd-round pinned phrases) or `repo.test.ts` (AC4) needs it, or where the slice-checks line contradicted the code.
- **W2** `.agents/skills` copies match the source
  **After:** `diff -r packages/cli/assets/skills .agents/skills` (norn*) is clean.
- **W3** `issue`, `release`, `release-start`
  **After:** identical to the proposals. Only a person can judge the wording.
- **W4** interview/refine/clarify dedup
  **After:** the terse-answer rule stays in norn-interview. norn-refine drops it, and norn-clarify defers to the interview.
- **W5** tdd/implement dedup
  **After:** "read the helpers before a test" stays in norn-tdd. norn-implement, which invokes it, drops it.
- **W6** norn-tdd's seam
  **Before:** "the public boundary". **After:** where a module's interface lives.
- **W7** norn-qa points to norn-qa-person
  **After:** the norn-qa description ends with "QA alongside a person is norn-qa-person." Added in implement#2 after review#1 flagged it.
- **D1** norn-retro is model-invocable
  **After:** `disable-model-invocation` is removed from its frontmatter.
- **D2** norn-prototype's home
  **After:** `<spec folder>/prototype/`. Only variants that must mount sit beside their page, with `prototype` in the file name.

W3–W6 can only be judged by reading the skills. Review checked them against the proposals.

## Merge danger

**Door:** two-way: a revert restores the old skill text. Repos that already ran `norn init` keep their copies until they run it again.

**Blast radius:** agents: changed skill text changes how agents do each step. The likeliest slips are a dropped instruction an agent relied on (the deduplicated rules now exist only in the skill that gets invoked) and norn-retro loading without being asked, now that it is model-invocable.
