## Summary

`norn-qa`, `norn-triage` and `norn-diagnose` now hand the context-heavy part of their work to subagents, the way `norn-review` already does. Each keeps a "when you cannot start subagents, do it yourself" fallback. The brief gets no blanket "use subagents" line.

```
norn-qa        prepare env once ─┬─ subagent per independent criterion → writes its evidence files
                                 └─ main agent judges evidence files, writes the criteria report
               (subagents that run commands get the hard rules with reasons: no push, no branch/worktree
                switch, no delivery-tool command, no writes under runs/)
norn-triage    subagent reads the code → returns `file:line` usages + conclusion, not the files
norn-diagnose  1. subagent finds the code involved → path (`file:line` per hop) + seams for a loop
               3. optional fresh subagent, given only the loop and the symptom → unanchored hypotheses,
                  merged and ranked with yours before testing any
```

## Evidence

No QA ran. These entries are unit tests in `packages/cli/test/unit/assets.test.ts` that read the shipped skill text. `bun run test` (1730 pass) and `bun run typecheck` were green at review. The `.agents/skills/` copies match `packages/cli/assets/skills/`.

- **norn-qa: one subagent per independent criterion, one prepared environment**
  **Before:** QA checked every criterion in turn, in one growing context.
  **After:** test "norn-qa collects each independent criterion's evidence in its own subagent against one prepared environment" asserts `text has "its own subagent", "the environment you prepared", "You write the criteria report"` and `/in parallel only…shared state/`.
- **norn-triage: a subagent reads the code and returns `file:line` usages and its conclusion**
  **Before:** triage read the files into its main context.
  **After:** test "norn-triage has a subagent read the code…" asserts `/subagent…`file:line` usages…conclusion…not the files/`.
- **norn-diagnose: exploration in a subagent, optional fresh subagent for unanchored hypotheses**
  **Before:** the agent that had the first idea also ranked and tested the hypotheses.
  **After:** test "norn-diagnose explores the code in a subagent…" asserts both passages, with the fresh subagent placed before `## 4. Instrument`.
- **Each skill keeps the do-it-yourself fallback**
  **Before:** only `norn-review` had it.
  **After:** `test.each([review, qa, triage, diagnose])` asserts `/When you cannot start subagents, …yourself/`.
- **A subagent that runs commands gets the hard rules it could break**
  **Before:** only `norn-review` listed them.
  **After:** the shared helper `expectSubagentRules("norn-qa")` asserts each rule is a `- rule — reason` line.
- **No blanket "use subagents" line in the brief**
  **After:** `packages/core/src/brief.ts` is not in the diff.

Not proven: whether agents actually split the work this way. Only real QA, triage and diagnose runs will show that. Review left one minor point for a person to decide: `norn-diagnose`'s fresh hypothesis subagent gets "the loop" but no rules, in case it runs the loop.

## Merge danger

**Door:** two-way: the change is skill text and tests, and a revert removes it completely.

**Blast radius:** agent runs: QA, triage and diagnose sessions start subagents, which costs more tokens. If a subagent's summary drops detail, a verdict could rest on less than it should. QA guards against that by judging from the evidence files, not the summary.
