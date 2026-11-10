# 06.AC4 golden corpus, transcripts, snapshots
$ git diff --stat origin/main...HEAD -- packages/core/test/golden
 packages/core/test/golden/run-state-move-3295a7de618d.json | 1 -
 packages/core/test/golden/run-state-move-92ccfe6e9389.json | 1 -
 packages/core/test/golden/run-state-move-beb2fa949864.json | 1 -
 packages/core/test/golden/run-state-move-ed6eaf5cf7fa.json | 1 -
 4 files changed, 4 deletions(-)

$ git diff origin/main...HEAD -- packages/core/test/rule-cases.ts
diff --git a/packages/core/test/rule-cases.ts b/packages/core/test/rule-cases.ts
index d47254188..2e7085b96 100644
--- a/packages/core/test/rule-cases.ts
+++ b/packages/core/test/rule-cases.ts
@@ -151,12 +151,6 @@ function cases(): RuleCase[] {
   out.push(c("the pinned workflow changed outside norn", "workflow.drift", facts([story(SOLO_WF, {}, null, {}, { workflow_hash: "edited" })])));
   out.push(c("a rebase waits in the unit's worktree past the step's deadline", "unit.rebase_in_progress", facts([story(SOLO_WF, running("implement", 2 * HOUR), null, {}, { worktree: { ...worktree(STORY_WT), in_progress: { operation: "rebase", unmerged: ["X.txt"] } } })])));
   // A held story whose record is still flat moves into round 1 first
-  // Run state an older norn left on a held unit's branch
-  const onBranch = { branch_record: { path: ".agents/specs/gh-1-login/runs", copy: ["_story"], holds: ["_story"] }, record: "_story" };
-  out.push(c("a held story's flat record still on its branch moves into round 1 of the machine dir", "record.move", facts([story(STORY_WF, { step: "slices" }, null, {}, onBranch)])));
-  out.push(
-    c("a story's branch run state waits out a merge in its worktree", "record.move_waits", facts([story(STORY_WF, { step: "slices" }, null, {}, { ...onBranch, worktree: { ...worktree(STORY_WT), in_progress: { operation: "merge", unmerged: [] } } })])),
-  );
   // Under record.policy remote, a held story whose record changed since the ref it last saw
   out.push(
     c(

$ bun test packages/core/test/unit/golden.test.ts  → 327 pass, 0 fail (replay of the remaining 132 cases)

$ git diff --stat origin/main...HEAD -- test/e2e/observe-snapshots  → (empty)

$ git diff origin/main...HEAD -- test/e2e/transcripts
diff --git a/test/e2e/transcripts/recovery-claim-lost.txt b/test/e2e/transcripts/recovery-claim-lost.txt
index 7798628f1..f42e91954 100644
--- a/test/e2e/transcripts/recovery-claim-lost.txt
+++ b/test/e2e/transcripts/recovery-claim-lost.txt
@@ -123,7 +123,6 @@
   spawn repo-b $ git rev-parse --verify --quiet --end-of-options refs/remotes/origin/gh-9-add-search
   spawn repo-b $ git rev-parse --verify --quiet --end-of-options refs/remotes/origin/gh-9-add-search
   spawn repo-b $ git show <sha:4>:.agents/specs/gh-9-add-search/spec.md
-  spawn repo-b $ git cat-file -e <sha:4>:.agents/specs/gh-9-add-search/runs
   spawn repo-b $ git show <sha:4>:.agents/workflows/solo.yaml
   spawn repo-b $ git log "--format=%x1e%(trailers:only,unfold)" "--grep=^Norn-Outcome: " refs/remotes/origin/gh-9-add-search
   spawn repo-b $ git ls-remote origin refs/norn/claims/gh-9
