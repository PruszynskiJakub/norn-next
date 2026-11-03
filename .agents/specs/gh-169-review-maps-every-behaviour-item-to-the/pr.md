## Summary

The `norn-review` skill's Spec axis now has to show which test proves each Behaviour item and acceptance criterion. An item with no test becomes a blocking finding, and the table goes into the review's handoff, where QA and the PR body can reuse it.

```diff
 review
   Spec subagent
+    build table: Behaviour item / criterion → test file › test name | UNTRACED
     report missing / unasked / wrong / untested
   decide
+    UNTRACED → blocking, unless frontmatter criteria verifier is agent|person
+      (then the row reads "QA (agent)" / "QA (person)"; no entry counts as verifier: test)
+  write the table into handoff.md's Progress section
   write findings JSON
```

The change is to the bundled skill (`packages/cli/assets/skills/norn-review/SKILL.md`) and this repo's copy of it in `.agents/skills/`. The `norn-review` row in `.agents/RULES.md`'s skills table now mentions the table. The skill names no QV rule ids (P7).

## Evidence

This story ran the `quick` workflow, which has no QA step, so there is no criteria report. The evidence is one content test, `packages/cli/test/unit/assets.test.ts` › "skills › norn-review traces every Behaviour item and criterion to a test, and writes the table into the handoff (gh-169)". It fails on `main`, where the skill has no `UNTRACED` and no table, and passes on this branch (1 pass, 10 expects). Unit tier 1104 pass, typecheck green.

- **W1** Spec axis builds the table, one row per item, a test or `UNTRACED`
  **Before:** did not exist. The Spec axis judged coverage in prose.
  **After:** the test asserts the skill contains `traceability table`, `| Item | Verifier | Proven by |` and `UNTRACED`.
- **W2** `UNTRACED` blocks unless the verifier is `agent`/`person`, and those point at QA
  **Before:** did not exist.
  **After:** the test matches the blocking sentence, including its `agent` or `person` exemption, and checks for `QA (agent)`, `QA (person)` and ``counts as `verifier: test` ``.
- **W3** The table goes into the review's handoff
  **Before:** did not exist.
  **After:** the test matches "Write the table into the handoff** (the Progress section". review#2 used this step and wrote its own table into this story's handoff.
- **W4** `.agents/skills/norn-review/SKILL.md` matches the bundled skill
  **Before:** the copies matched, but nothing checked it.
  **After:** the test asserts the `.agents` copy `toBe` the bundled text.

The test pins the skill's wording, not how well an agent follows it. To check that, read the table in the next story's review handoff.

## Merge danger

**Door:** two-way. The change is a skill's text plus one test, and a revert undoes all of it.

**Blast radius:** reviews. Every later `review` step follows the new skill and blocks on `UNTRACED` rows. A spec with no frontmatter `criteria` treats every item as `verifier: test`, so it now needs a test for every item or its review sends the work back. This happened once on this branch (review#1).
