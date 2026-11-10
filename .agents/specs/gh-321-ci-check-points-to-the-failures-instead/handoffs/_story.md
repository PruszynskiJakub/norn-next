### Goal

When the `ci` check fails, the rework brief shows where the failures are (run/check-run links, failed ids, the annotations command), never the log tail.

### Proof

- New `.agents/scripts/ci-failures.sh <run-id>`; repo workflows `story.yaml`, `quick.yaml`, `release.yaml` call it instead of `--log-failed | tail -300`.
- Shipped `packages/cli/assets/workflows/{story,quick}.yaml`: inline listing of failed check runs from `commits/$sha/check-runs`, then the annotations command.
- The diff of these files matches the issue's drafted patch line for line (review checked it).
- Review re-ran every command against run 42794918379; output in the review evidence (`ci-failures-run-42794918379.txt`).
- `packages/cli/test/integration/ci-check.test.ts` covers both scripts against a fake gh: repo path prints the run URL, failed job and annotations command with no `--log-failed` call; shipped path prints `gh pr checks`, the failed check-run line and the annotations command, with no `gh run` call. Passes locally under `bunfig.integration.toml` (8/8).
- `bun run test`, `bun run typecheck` green; `docs:emit` produced no change (re-checked in review).

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | on a failed CI run the "Failing check" block holds the run/check-run links, failed ids and the annotations command in about 10 lines, no test log | agent (hand check; no test seam for workflow shell) | QA (agent): review ran `sh .agents/scripts/ci-failures.sh 42794918379` → 5 lines (run URL, `- job 129757664390: integration (shard 3/4)`, annotations command, `--log-failed --job` fallback); shipped check-runs query → `- integration (shard 3/4) (id 129757664390): <job link>`; shipped echo lines render correctly under sh |
| AC2 | the printed annotations command for a failed integration job shows the failing assertion with file and line, and no `.github` noise | agent (hand check) | QA (agent): annotations for check run 129757664390 → `packages/cli/test/integration/upgrade.test.ts:227 Expected: true / Received: false`, no `.github` entries |
| AC3 | a green CI run still exits 0 with no output | agent (hand check) | QA (agent): by reading — `gh run watch … && exit 0` / `gh pr checks --watch … && exit 0` still precede the new lines, unchanged by the diff |

### Easy to miss

- The shipped assets must not say the banned glossary word for Actions jobs, so they use check runs (whose id is what the annotations endpoint takes).
- Core and `brief.ts` (`TAIL_LINES`) stay unchanged, as the issue says.

### Not proven yet

- The `ci` check after this fix: the integration tier runs in CI only.

### Notes

- Review: approve, no findings. The criteria have no frontmatter verifiers, but the spec prescribes hand verification against a live run and the unit tier cannot run workflow shell, so the rows are proven by the reviewer's re-run rather than marked UNTRACED; a person can overrule that.
- ci#1 failed on `ci-check.test.ts` (integration shard 4/4): its fake gh still expected the old `--log-failed` calls, and the repo script runs `.agents/scripts/ci-failures.sh` relative to cwd, so the test now copies that script into its fake checkout. The new repo-path output did point straight at the failure (AC1/AC2 shown live).
- Run one integration file locally: `bun test --config=bunfig.integration.toml --timeout=20000 ./packages/cli/test/integration/ci-check.test.ts` (a bare `bun test <file>` finds no file).
- Friction: the worktree had no `node_modules`, so the first `bun run test` failed 75 tests until `bun install`.

### Resume

implement#2 fixed the ci-check integration test for the new output. Next: norn's open-pr pushes, then `ci` re-runs; if it fails again, read the annotations command it prints.
