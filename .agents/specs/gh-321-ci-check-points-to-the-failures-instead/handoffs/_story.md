### Goal

When the `ci` check fails, the rework brief shows where the failures are (run/check-run links, failed ids, the annotations command), never the log tail.

### Proof

- New `.agents/scripts/ci-failures.sh <run-id>`; repo workflows `story.yaml`, `quick.yaml`, `release.yaml` call it instead of `--log-failed | tail -300`.
- Shipped `packages/cli/assets/workflows/{story,quick}.yaml`: inline listing of failed check runs from `commits/$sha/check-runs`, then the annotations command.
- The diff of these files matches the issue's drafted patch line for line (review checked it).
- Review re-ran every command against run 42794918379; output in the review evidence (`ci-failures-run-42794918379.txt`).
- `bun run test`, `bun run typecheck` green (test#1); `docs:emit` produced no change (re-checked in review).

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | on a failed CI run the "Failing check" block holds the run/check-run links, failed ids and the annotations command in about 10 lines, no test log | agent (hand check; no test seam for workflow shell) | QA (agent): review ran `sh .agents/scripts/ci-failures.sh 42794918379` → 5 lines (run URL, `- job 129757664390: integration (shard 3/4)`, annotations command, `--log-failed --job` fallback); shipped check-runs query → `- integration (shard 3/4) (id 129757664390): <job link>`; shipped echo lines render correctly under sh |
| AC2 | the printed annotations command for a failed integration job shows the failing assertion with file and line, and no `.github` noise | agent (hand check) | QA (agent): annotations for check run 129757664390 → `packages/cli/test/integration/upgrade.test.ts:227 Expected: true / Received: false`, no `.github` entries |
| AC3 | a green CI run still exits 0 with no output | agent (hand check) | QA (agent): by reading — `gh run watch … && exit 0` / `gh pr checks --watch … && exit 0` still precede the new lines, unchanged by the diff |

### Easy to miss

- The shipped assets must not say the banned glossary word for Actions jobs, so they use check runs (whose id is what the annotations endpoint takes).
- Core and `brief.ts` (`TAIL_LINES`) stay unchanged, as the issue says.

### Not proven yet

- The new `ci` check has not run end to end on a red PR; this story's own `ci` step exercises the repo path only if CI fails.

### Notes

- Review: approve, no findings. The criteria have no frontmatter verifiers, but the spec prescribes hand verification against a live run and the unit tier cannot run workflow shell, so the rows are proven by the reviewer's re-run rather than marked UNTRACED; a person can overrule that.
- Friction: the worktree had no `node_modules`, so the first `bun run test` failed 75 tests until `bun install`.

### Resume

Review approved; next is open-pr then the `ci` step, driven by norn.
