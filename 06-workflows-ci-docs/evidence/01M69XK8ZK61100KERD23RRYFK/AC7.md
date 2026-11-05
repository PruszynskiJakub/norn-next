## AC7
$ sed -n "/^## Commands/,/^## Layout/p" AGENTS.md | grep -n "bun run test"
5:bun run test        # the unit tier, in seconds: your loop after each change; a plain `bun test` runs exactly this
6:bun run test:integration  # the integration tier (packages/*/test/integration/), in parallel: the workflow's test check runs it
7:bun run test:e2e    # the e2e tier (test/e2e/), in parallel: CI runs it in shards; `bun run test:e2e <file>` runs one file
16:Effect transcripts pin what three harness flows do to the world: the child processes norn spawns (store's `setSpawnObserver` hook, off by default: `spawnBounded`, store's git calls and each spawn that calls `noteSpawn`, which includes check commands; the `ps`/`lsof` pid probes are not recorded), every call on the fake ports, and every file under `runs/` that appears, changes or goes away, with the content of each one added or changed (JSON as one line, other text as a hash), normalised (temp dirs, ulids, shas, timestamps). The recorder is `test/support/transcript.ts`; the flows are the last test of `test/e2e/slice-workflow.test.ts` (slice workflow), `test/e2e/base-sync.test.ts` (base sync) and `test/e2e/recovery.test.ts` (claim lost), against `test/e2e/transcripts/*.txt`. A change that keeps behaviour leaves them alone; for an intended change, rewrite them with `NORN_TRANSCRIPT_UPDATE=1 bun run test:e2e <file>` and review the diff.
18:Observe snapshots pin what `observe` sees at five points of one story in `test/e2e/observe-snapshots.test.ts` (fresh intake, running slice, parked ask, gate waiting, merged): the Facts, normalised the same way, against `test/e2e/observe-snapshots/*.json`. At each point the test also checks inbox parity: the inbox `norn status` shows (`loadProjectView`) must equal `buildInbox` over observe's Facts. The helpers are in `test/support/observe-snapshot.ts`. Rewrite the snapshots with `NORN_TRANSCRIPT_UPDATE=1 bun run test:e2e test/e2e/observe-snapshots.test.ts`, again only for an intended change.
24:Tests come in three tiers, by folder: **unit** (`packages/<pkg>/test/unit/`, `test/repo/` and the rest of the root `test/` but `test/e2e/` and `test/support/`; in-process only: a preload fails a unit test that starts a child process), **integration** (`packages/<pkg>/test/integration/`: real git, real processes, the cli harness) and **e2e** (`test/e2e/`: multi-tick stories, effect transcripts, observe snapshots). Shared helpers sit in `test/support/`. The unit tier (`bun run test`) and the type check must pass before you hand work back; a workflow's `test` check runs the unit tier, the integration tier and the type check, and `quick` and `story` then wait for the PR's CI in a `ci` check, which sends a red run back to `implement` (`release` waits for it too, with no local test, and goes `$stuck` on a red run). CI (`.github/workflows/ci.yml`) runs the unit tier and the type check on every PR, then, once they pass, the integration tier, the e2e tier in three shards, and the npm package and a binary built and checked with `scripts/smoke.sh`; the release run tests only the unit tier and the type check, since the release PR's CI ran every tier; a release also smokes each binary on its own OS (macOS arm64/x64, Linux arm64). A test fails if the emitted JSON schemas are stale.

### paths named in AGENTS.md (golden/transcript/snapshot/contract)
exists  packages/core/test/golden.test.ts
exists  packages/core/test/rule-cases.ts
exists  test/support/transcript.ts
exists  test/e2e/slice-workflow.test.ts
exists  test/e2e/base-sync.test.ts
exists  test/e2e/recovery.test.ts
exists  test/e2e/transcripts
exists  test/e2e/observe-snapshots.test.ts
exists  test/e2e/observe-snapshots
exists  test/support/observe-snapshot.ts
exists  packages/adapters/test/contract
exists  packages/cli/test/integration/contract-fakes.test.ts

$ grep -n "contract.test.ts" -r packages/adapters/test/contract
contract.test.ts
git.ts
process.ts
remote-cli.ts
remote.ts
runner.ts
suite.ts
zombie.ts

### README test lines
240:bun run test           # the unit tier, in seconds (a plain `bun test` runs the same)
241:bun run test:integration  # real git and the cli harness
242:bun run test:e2e       # multi-tick stories; CI runs it in shards

$ ls test/e2e/transcripts test/e2e/observe-snapshots
test/e2e/observe-snapshots:
fresh-intake.json
gate-waiting.json
merged.json
parked-ask.json
running-slice.json

test/e2e/transcripts:
base-sync.txt
e2e-slice-workflow.txt
recovery-claim-lost.txt
$ git grep -n -i "all tests" README.md AGENTS.md CONTRIBUTING.md
exit 1
