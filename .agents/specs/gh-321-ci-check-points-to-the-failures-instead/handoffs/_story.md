### Goal

When the `ci` check fails, the rework brief shows where the failures are (run/check-run links, failed ids, the annotations command), never the log tail.

### Proof

- New `.agents/scripts/ci-failures.sh <run-id>`; repo workflows `story.yaml`, `quick.yaml`, `release.yaml` call it instead of `--log-failed | tail -300`.
- Shipped `packages/cli/assets/workflows/{story,quick}.yaml`: inline listing of failed check runs from `commits/$sha/check-runs`, then the annotations command.
- Failing check block in about 10 lines, no log: `sh .agents/scripts/ci-failures.sh 42794918379` prints 5 lines (run URL, `- job 129757664390: integration (shard 3/4)`, the annotations command, the `--log-failed --job` fallback).
- The annotations command shows the assertion: for check run 129757664390 it prints `packages/cli/test/integration/upgrade.test.ts:227 Expected: true / Received: false` and no `.github` entries.
- Shipped inline command: its check-runs query for that run's head sha prints `- integration (shard 3/4) (id 129757664390): <job link>`; its echo lines render the annotations command correctly under sh.
- Green run exits 0 with no output: unchanged, since `gh run watch … && exit 0` / `gh pr checks --watch … && exit 0` still come before the new lines.
- `bun run test` (1732 pass), `bun run typecheck` green; `docs:emit` produced no change.

### Easy to miss

- The shipped assets must not say the banned glossary word for Actions jobs, so they use check runs (whose id is what the annotations endpoint takes).
- Core and `brief.ts` (`TAIL_LINES`) stay unchanged, as the issue says.

### Not proven yet

- The new `ci` check has not run end to end on a red PR yet; this story's own `ci` step exercises the repo path only if CI fails.

### Notes

- Applied the patch drafted in the issue as is; no test was added because the change is to workflow shell scripts, which the unit tier does not run. Verified by hand against run 42794918379 instead.
- Friction: the worktree had no `node_modules`, so the first `bun run test` failed 75 tests until `bun install`.

### Resume

Nothing left for implement; the next step opens the PR.
