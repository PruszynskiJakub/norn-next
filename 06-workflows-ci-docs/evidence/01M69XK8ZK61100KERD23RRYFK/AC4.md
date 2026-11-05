## AC4
diff --git a/packages/cli/assets/skills/norn-implement/SKILL.md b/packages/cli/assets/skills/norn-implement/SKILL.md
index 410698fc7..82e6bb3dd 100644
--- a/packages/cli/assets/skills/norn-implement/SKILL.md
+++ b/packages/cli/assets/skills/norn-implement/SKILL.md
@@ -17,7 +17,7 @@ Make every acceptance criterion true, each proven by a test that failed before t
 
    Then go on with any criteria not yet covered.
 3. **Build test-first.** Invoke the `norn-tdd` skill and work red → green, one tracer bullet at a time. The seams in the Plan were agreed during planning: they are the pre-agreed seams the `norn-tdd` skill asks for. When a behaviour cannot be observed at any of them, use the highest existing seam that observes it and say so when you hand back. Never write code for a behaviour that has no failing test yet.
-4. Run the type check and the test file you are in often, and the whole suite before each commit.
+4. Run the type check and the repo's fast suite after each change. Slower tiers (integration, end-to-end) run in their own check; do not run them before handing back.
 5. **Review pass.** Read your whole diff the way review will: every acceptance criterion (or rework point) met and nothing beyond it, the repo's documented standards, and the smells in [the `norn-review` skill's SMELLS.md](../norn-review/SMELLS.md). Refactor here, not inside the loop, with the suite green after each change.
 
 ## Rules
@@ -27,4 +27,4 @@ Make every acceptance criterion true, each proven by a test that failed before t
 - If a criterion is ambiguous or contradicts the code, stop and say what decision is needed rather than guessing.
 - Commit locally; never push.
 
-Done when every acceptance criterion (or every rework point) has a passing test at an agreed seam that would fail without the change, the type check, linters and full suite are green, the work is committed, and no unrelated changes remain in the diff.
+Done when every acceptance criterion (or every rework point) has a passing test at an agreed seam that would fail without the change, the type check, linters and the repo's fast suite are green (slower tiers run in their own check), the work is committed, and no unrelated changes remain in the diff.
$ grep -n "full suite" packages/cli/assets/skills/norn-implement/SKILL.md
exit 1
$ grep -n "full suite" packages/cli/assets/skills/norn-merge/SKILL.md (D9: stays)
45:Done when no conflict markers remain, the operation completed and is committed, both sides' behaviour and tests survive, and the full suite passes — or, when you stopped, the operation is aborted, the worktree is clean, and you said which decision is needed.
