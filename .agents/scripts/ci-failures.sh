#!/bin/sh
# Prints where a failed GitHub Actions run's failures are, never the log itself: this output lands
# in the rework brief, and a failed step's log is the whole test shard, which buries the failure.
# Usage: ci-failures.sh <run-id>
run=${1:?usage: ci-failures.sh <run-id>}
echo "CI run $run failed: $(gh run view "$run" --json url -q .url)"
# a cancelled or skipped job is listed too: it never ran to the end, so a rework must not take it for a pass
gh run view "$run" --json jobs -q '.jobs[] | select(.conclusion=="failure" or .conclusion=="cancelled" or .conclusion=="skipped") | "- job \(.databaseId): \(.name)" + (if .conclusion=="failure" then "" else " (\(.conclusion): unknown, not run to the end)" end)'
cat <<EOF
Read a job's failures (file, line, message):
  gh api "repos/{owner}/{repo}/check-runs/<job>/annotations" -q '.[] | select(.annotation_level=="failure" and .path!=".github") | "\(.path):\(.start_line) \(.message)"'
Only if that is not enough, the job's failed step log: gh run view $run --log-failed --job <job>
EOF
