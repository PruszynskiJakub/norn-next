---
id: gh-321
slug: ci-check-points-to-the-failures-instead
provider: gh
number: 321
url: https://github.com/PruszynskiJakub/norn-next/issues/321
title: CI check points to the failures instead of inlining the log
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:quick
workflow: quick
status: active
intake_at: 2026-11-10T10:13:06.916Z
body_hash: 34ebe74441de46b5085a361588e72eada28b84c1bba1b3244ef73401a8c3833c
---

## Observed

When the `ci` check fails, the rework brief inlines the tail of `gh run view --log-failed`. A failed step is the whole test shard, so the output is mostly passing tests and job cleanup. The brief keeps only its last 60 lines (`TAIL_LINES` in `packages/core/src/brief.ts:218`). In gh-318 that cut out the actual assertion (`upgrade.test.ts:227 Expected: true / Received: false`): the agent saw the failing test's name but not why it failed.

## Wanted

The `ci` check prints where the failures are, never the log. The agent fetches them on demand through GitHub's annotations API, which returns only the failures (file, line, message).

- **This repo:** a new `.agents/scripts/ci-failures.sh <run-id>` prints the run URL, the failed jobs with their ids, the annotations command and, as a fallback, `gh run view <run> --log-failed --job <job>`. In `.agents/workflows/story.yaml`, `quick.yaml` and `release.yaml`, `ci` calls `sh .agents/scripts/ci-failures.sh "$run"` instead of `--log-failed | tail -300`.
- **Shipped assets** (`packages/cli/assets/workflows/story.yaml`, `quick.yaml`): the command stays inline. After `gh pr checks`, it lists the failed check runs from `commits/$sha/check-runs` (name, id, link), then the annotations command. It uses check runs rather than Actions jobs because the glossary lint bans that word, and a check run's id is the one the annotations endpoint takes.
- Core and the brief do not change.

## Acceptance criteria

1. On a failed CI run, the brief's "Failing check" block holds the run or check-run links, the failed ids and the annotations command, in about 10 lines, with no test log.
2. Running the printed annotations command for a failed integration job shows the failing assertion with its file and line, and none of the `.github` noise annotations.
3. A green CI run still exits 0 with no output.

## Patch

Drafted and checked in an ad-hoc session against run 42794918379. `bun run test` and `bun run typecheck` were green, and `docs:emit` produced no change. Apply it, then verify:

```diff
diff --git a/.agents/scripts/ci-failures.sh b/.agents/scripts/ci-failures.sh
new file mode 100755
index 000000000..3705456fb
--- /dev/null
+++ b/.agents/scripts/ci-failures.sh
@@ -0,0 +1,12 @@
+#!/bin/sh
+# Prints where a failed GitHub Actions run's failures are, never the log itself: this output lands
+# in the rework brief, and a failed step's log is the whole test shard, which buries the failure.
+# Usage: ci-failures.sh <run-id>
+run=${1:?usage: ci-failures.sh <run-id>}
+echo "CI run $run failed: $(gh run view "$run" --json url -q .url)"
+gh run view "$run" --json jobs -q '.jobs[] | select(.conclusion=="failure") | "- job \(.databaseId): \(.name)"'
+cat <<EOF
+Read a job's failures (file, line, message):
+  gh api "repos/{owner}/{repo}/check-runs/<job>/annotations" -q '.[] | select(.annotation_level=="failure" and .path!=".github") | "\(.path):\(.start_line) \(.message)"'
+Only if that is not enough, the job's failed step log: gh run view $run --log-failed --job <job>
+EOF
diff --git a/.agents/workflows/quick.yaml b/.agents/workflows/quick.yaml
index 10efb946e..89b2aae18 100644
--- a/.agents/workflows/quick.yaml
+++ b/.agents/workflows/quick.yaml
@@ -72,8 +72,8 @@ steps:
     action: open-pr
     outcomes: { done: ci }
   # waits for the PR's CI (a detached check run, so the tick is not blocked): the ci.yml run of the
-  # PR's head commit, up to 5m for it to appear, else fail; a red run's failed
-  # log becomes last_check for implement, whose rework goes back through open-pr to the new head
+  # PR's head commit, up to 5m for it to appear, else fail; where a red run's failures are
+  # becomes last_check for implement, whose rework goes back through open-pr to the new head
   ci:
     type: check
     run: |
@@ -86,7 +86,7 @@ steps:
       done
       [ -n "$run" ] || { echo "no ci.yml run for $sha after 5m"; exit 1; }
       gh run watch "$run" --exit-status --interval 30 >/dev/null && exit 0
-      gh run view "$run" --log-failed | tail -300
+      sh .agents/scripts/ci-failures.sh "$run"
       exit 1
     timeout: 30m
     outcomes: { pass: ready, fail: { to: implement, counter: ci_loop } }
diff --git a/.agents/workflows/release.yaml b/.agents/workflows/release.yaml
index 969f4de19..2dad88aba 100644
--- a/.agents/workflows/release.yaml
+++ b/.agents/workflows/release.yaml
@@ -60,7 +60,7 @@ steps:
       done
       [ -n "$run" ] || { echo "no ci.yml run for $sha after 5m"; exit 1; }
       gh run watch "$run" --exit-status --interval 30 >/dev/null && exit 0
-      gh run view "$run" --log-failed | tail -300
+      sh .agents/scripts/ci-failures.sh "$run"
       exit 1
     timeout: 30m
     outcomes: { pass: ready, fail: $stuck }
diff --git a/.agents/workflows/story.yaml b/.agents/workflows/story.yaml
index 9f14069ed..975488c5c 100644
--- a/.agents/workflows/story.yaml
+++ b/.agents/workflows/story.yaml
@@ -106,8 +106,8 @@ steps:
     action: open-pr
     outcomes: { done: ci }
   # waits for the PR's CI (a detached check run, so the tick is not blocked): the ci.yml run of the
-  # PR's head commit, up to 5m for it to appear, else fail; a red run's failed
-  # log becomes last_check for implement, whose rework goes back through open-pr to the new head
+  # PR's head commit, up to 5m for it to appear, else fail; where a red run's failures are
+  # becomes last_check for implement, whose rework goes back through open-pr to the new head
   ci:
     type: check
     run: |
@@ -120,7 +120,7 @@ steps:
       done
       [ -n "$run" ] || { echo "no ci.yml run for $sha after 5m"; exit 1; }
       gh run watch "$run" --exit-status --interval 30 >/dev/null && exit 0
-      gh run view "$run" --log-failed | tail -300
+      sh .agents/scripts/ci-failures.sh "$run"
       exit 1
     timeout: 30m
     outcomes: { pass: ready, fail: { to: implement, counter: ci_loop } }
diff --git a/packages/cli/assets/workflows/quick.yaml b/packages/cli/assets/workflows/quick.yaml
index 4ea5e620e..c13ab7a79 100644
--- a/packages/cli/assets/workflows/quick.yaml
+++ b/packages/cli/assets/workflows/quick.yaml
@@ -73,7 +73,7 @@ steps:
     outcomes: { done: ci }
   # waits for the checks on the PR's head commit (a detached check run, so the tick is not blocked):
   # up to 5m for a first check to appear, none means the repo has no CI and passes; a red check's
-  # failed log becomes last_check for implement, whose rework goes back through open-pr to the new head.
+  # failures' whereabouts become last_check for implement, whose rework goes back through open-pr to the new head.
   # GitHub (gh) only: on GitLab replace the script, or route open-pr's done straight to ready.
   ci:
     type: check
@@ -90,9 +90,11 @@ steps:
       [ "$n" -gt 0 ] || { echo "no checks on PR #$pr after 5m: nothing to wait for"; exit 0; }
       gh pr checks "$pr" --watch --interval 30 >/dev/null && exit 0
       gh pr checks "$pr"
-      for run in $(gh run list --commit "$sha" --status failure --json databaseId -q '.[].databaseId'); do
-        gh run view "$run" --log-failed | tail -200
-      done
+      # where the failures are, never the log: a failed step's log buries the failure in passing output
+      gh api "repos/{owner}/{repo}/commits/$sha/check-runs?per_page=100" -q '.check_runs[] | select(.conclusion=="failure") | "- \(.name) (id \(.id)): \(.details_url)"'
+      echo "Read a failed check run's annotations (file, line, message):"
+      echo "  gh api \"repos/{owner}/{repo}/check-runs/<id>/annotations\" -q '.[] | select(.annotation_level==\"failure\" and .path!=\".github\") | \"\\(.path):\\(.start_line) \\(.message)\"'"
+      echo "Only if that is not enough, the full log is behind its link."
       exit 1
     timeout: 30m
     outcomes: { pass: ready, fail: { to: implement, counter: ci_loop } }
diff --git a/packages/cli/assets/workflows/story.yaml b/packages/cli/assets/workflows/story.yaml
index 3c9303c55..b363d8ba0 100644
--- a/packages/cli/assets/workflows/story.yaml
+++ b/packages/cli/assets/workflows/story.yaml
@@ -110,7 +110,7 @@ steps:
     outcomes: { done: ci }
   # waits for the checks on the PR's head commit (a detached check run, so the tick is not blocked):
   # up to 5m for a first check to appear, none means the repo has no CI and passes; a red check's
-  # failed log becomes last_check for implement, whose rework goes back through open-pr to the new head.
+  # failures' whereabouts become last_check for implement, whose rework goes back through open-pr to the new head.
   # GitHub (gh) only: on GitLab replace the script, or route open-pr's done straight to ready.
   ci:
     type: check
@@ -127,9 +127,11 @@ steps:
       [ "$n" -gt 0 ] || { echo "no checks on PR #$pr after 5m: nothing to wait for"; exit 0; }
       gh pr checks "$pr" --watch --interval 30 >/dev/null && exit 0
       gh pr checks "$pr"
-      for run in $(gh run list --commit "$sha" --status failure --json databaseId -q '.[].databaseId'); do
-        gh run view "$run" --log-failed | tail -200
-      done
+      # where the failures are, never the log: a failed step's log buries the failure in passing output
+      gh api "repos/{owner}/{repo}/commits/$sha/check-runs?per_page=100" -q '.check_runs[] | select(.conclusion=="failure") | "- \(.name) (id \(.id)): \(.details_url)"'
+      echo "Read a failed check run's annotations (file, line, message):"
+      echo "  gh api \"repos/{owner}/{repo}/check-runs/<id>/annotations\" -q '.[] | select(.annotation_level==\"failure\" and .path!=\".github\") | \"\\(.path):\\(.start_line) \\(.message)\"'"
+      echo "Only if that is not enough, the full log is behind its link."
       exit 1
     timeout: 30m
     outcomes: { pass: ready, fail: { to: implement, counter: ci_loop } }
```
