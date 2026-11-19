# Development

The contributor reference for norn's own code: the commands, the test tiers and CI, the plugin contract and the suites that hold every plugin to it, where each contract lives, how a release runs, and the design decisions behind the code. The short map an agent reads first is [`AGENTS.md`](../AGENTS.md); the person's side of contributing is [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Commands

```sh
bun install
bun run test        # the unit tier, in seconds: your loop after each change; a plain `bun test` runs exactly this
bun run test:integration  # the integration tier (packages/*/test/integration/), 6 workers: CI runs it in shards, never a local check
bun run typecheck   # tsc --noEmit over every package and scripts/
bun run schema:emit # regenerate packages/schema/json/*.schema.json after changing a schema
bun run docs:emit   # regenerate docs/reference.md's generated block after changing a command, flag, config key or the pack's workflows
bun run build       # dist/npm/: one bundled norn.js + package.json; build:bin [<target>…] builds the binaries
bun run golden -- --update  # behaviour change: re-decide every golden case, rewrite only its decisions
bun run golden      # add the golden cases the scenarios in packages/kernel/scripts/golden/ produce
```

To run the integration tests of one package, as you do after changing it: `bun test --config=bunfig.integration.toml --timeout=60000 packages/<pkg>`.

## Layout

norn is a thin kernel with a plugin contract. The kernel decides; plugins fill **slots** and do one effect per call; the runtime hosts both; the cli wires the plugins a config picks and offers the commands.

```
packages/schema           @norn/schema           JSON Schemas (TypeBox) + types + ajv validators, ids, the CliError and ExitCode contract
packages/plugin-api       @norn/plugin-api       the plugin contract: defineNornPlugin, the slots, HostContext, PluginResult, harness events, story keys, the plugin API version
packages/kernel           @norn/kernel           pure: workflow loader and counters, the model (facts, actions, receipts, run state), decide, the journal's write rules, the session reducer and classifier, the brief
packages/runtime          @norn/runtime          the host: tick (lock, gather facts, decide, act, trace), slot resolution, the launcher (executor = harness + runner), hook ingest and event log, inputs and skills in worktrees, detached checks, the open-pr and await-merge step kinds
packages/host-node        @norn/host-node        the HostContext over Bun and node: atomic file writes, exec with a bound, detached processes
packages/vcs-git          @norn/vcs-git          the vcs slot over git (worktrees, merge, push, refs) and the update-branch, integrate, push and verify-base step kinds
packages/tracker-local    @norn/tracker-local    a tracker over one markdown file per item
packages/plugin-github    @norn/plugin-github    a tracker over issues and a forge over pull requests, through gh
packages/forge-none       @norn/forge-none       a forge for a repo with no code host: a local record of each change, merged with git
packages/store-local      @norn/store-local      a store in the machine dir (runs-v2/stories/<story>/…)
packages/store-refs       @norn/store-refs       a store on git refs (refs/norn/v2/…) shared through the remote
packages/harness-claude   @norn/harness-claude   the Claude Code harness: hooks in .claude/settings.local.json, launch, normalize, respond
packages/harness-pi       @norn/harness-pi       the pi harness: an extension pi loads, launch, normalize, respond
packages/runner-headless  @norn/runner-headless  agents as detached processes, output to a log
packages/runner-herdr     @norn/runner-herdr     agents in Herdr panes, one workspace per story and one tab per run
packages/pack-sdlc        @norn/pack-sdlc        the sdlc pack: workflows, shared files and skills, imported as text
packages/conformance      @norn/conformance      contract suites (store, tracker, forge, harness), in-memory fakes, recorded-session replay
packages/cli              @norn/cli              wiring + commands, the layered config, plugin install and lock, init and doctor; bin `norn` → src/main.ts
```

Dependencies point one way only: `schema ← plugin-api ← kernel ← runtime ← cli`. A plugin package reads only `schema` and `plugin-api` (`pack-sdlc` only `plugin-api`), so a third-party plugin needs nothing a bundled one does not; `conformance` adds `kernel`, since its harness suite replays through the kernel's reducer; `cli` wires them all. `test/repo/repo.test.ts` enforces this: every `@norn/*` import must be allowed **and** declared in the package's `package.json`. Bun's isolated linker also hides undeclared packages.

### The slots

A plugin is one value made with `defineNornPlugin({ name, api, provides })`; `api` is the plugin API range it was written against, and the cli refuses a plugin whose range this norn does not satisfy. `provides` fills any of these slots, each keyed by the name a config picks it by:

| Slot | Contract | Bundled |
|---|---|---|
| `harness` | the agent tool: install its hooks in a worktree, launch it, normalize its hook payloads into harness events, render norn's answer back | `claude`, `pi` |
| `tracker` | where stories come from: list items, intake label, comments, close | `github`, `local` |
| `forge` | changes for review: open or update a change, read its state and checks | `github`, `none` |
| `store` | run data: numbered receipts, state by compare-and-swap, claims, mailbox, artifacts | `local`, `refs` |
| `vcs` | branches and worktrees: merge (never rebase), conflicts, push | `git` |
| `runners` | where an agent process runs | `headless`, `herdr` |
| `stepKinds` | a workflow head key beyond the kernel's own `agent`, `check`, `gate`, `slices` | `update-branch`, `integrate`, `push`, `verify-base` (vcs-git), `open-pr`, `await-merge` (runtime) |
| `packs` | workflows, shared files and skills shipped together | `sdlc` |

Every slot call returns a `PluginResult` and never throws. A plugin gets a `HostContext` (files, exec, processes, clock, the repo's root and data dir) and touches the machine only through it. A tracker, forge or store is never a state store for the kernel's decisions: labels and comments they write are display for people.

## Test tiers and CI

Tests come in two tiers, by folder:

- **unit**: `packages/<pkg>/test/unit/`, `test/repo/` and the rest of the root `test/` but `test/support/`. In-process only: a preload fails a unit test that starts a child process.
- **integration**: `packages/<pkg>/test/integration/`. Real git, real processes, the binary from source.

Shared helpers sit in `test/support/` and in each package's test folder. Tests never sit in `src/`. `test/repo/repo.test.ts` enforces the layout.

The unit tier (`bun run test`) and the type check must pass before you hand work back. **Commit only when `bun run test` and `bun run typecheck` are green**, and run both before every commit, not only before handing back. There is no `bun run lint`: the lints run inside the unit tier, so a red `bun run test` is a red lint too. They are:

- dependency direction, layout, glossary, path spelling and the IO ratchets in `test/repo/repo.test.ts`: file writes only in `@norn/host-node`, `JSON.parse` only in schema (and the few allowlisted tool-output reads), `Bun.spawn` only in host-node, and a pure kernel;
- the docs lint in `test/repo/docs.test.ts` (doc set in `test/support/docs.ts`);
- the repo's skills in `test/repo/process.test.ts`.

The docs lint fails on a rules file coming back, a link or anchor that does not resolve, a `norn` command or flag the CLI does not have, a version named outside the README badge and the changelog, and a handoff tracked in the repo outside a spec folder's `handoffs/`. A test also fails if the emitted JSON schemas or the generated block of `docs/reference.md` (`packages/cli/test/unit/reference.test.ts`) are stale.

CI (`.github/workflows/ci.yml`) runs the unit tier and the type check on every PR. Once they pass, it runs the integration tier in four shards, and builds the npm package and a binary and checks both with `scripts/smoke.sh`. The release run tests only the unit tier and the type check, since the release PR's CI ran every tier.

## Writing a test

Read `test/support/` first, then the support of the layer you test:

- `packages/conformance/src/fakes.ts`: `memoryHost`, `memoryFiles`, `scriptedExec`, `manualClock` and `steppingClock`, an in-memory `HostContext` any plugin or the runtime runs on.
- `packages/runtime/test/unit/support.ts`: a tick host over the real local store on memory files and recording fakes for tracker, forge, vcs, harness and launcher, so a test reads as the moments of a story.
- `packages/cli/test/unit/support.ts`: the cli in-process on an in-memory machine; `packages/cli/test/integration/world.ts`: a temp repo cloned from a bare remote, a temp norn home, and every call a subprocess of the binary from source, with the test harness plugin in `packages/cli/test/integration/fixtures/` installed through `norn plugin add`.

Take ref names and shapes from the code, never by hand: story keys and unit ids from `@norn/plugin-api` (`parseStoryKey`, `parseUnitId`), store refs from `packages/store-refs/src/layout.ts`, and receipt, run-state and config shapes from the kernel's model and `@norn/schema` (validate with `assertValid`).

## Golden cases

`packages/kernel/test/unit/golden.test.ts` replays every case in `packages/kernel/test/golden/` through `decide` and wants exactly the decisions recorded. The corpus fires every rule id in `RULE_IDS` at least once; `packages/kernel/test/unit/parity.test.ts` holds `packages/kernel/test/parity.md`, the map from the old engine's rules to the kernel's, to that list.

A change that keeps behaviour leaves the corpus alone. For an intended change in what decide decides, run `bun run golden -- --update`. It decides each existing case again and rewrites only its `decisions` (names, facts, workflows and config stay), printing the decisions that went and came per case, so the diff is exactly the behaviour change; review it.

`bun run golden` alone only adds cases: it plays every scenario in `packages/kernel/scripts/golden/` through the model host and writes each case whose name is not in the corpus yet, never touching an existing one.

## Conformance suites

A slot's contract is a suite in `@norn/conformance` that every implementation runs, so a third-party plugin is held to the same reads as a bundled one:

- `storeContract`, `trackerContract` and `forgeContract` state what a store, tracker or forge must do (idempotent effects by receipt id, compare-and-swap that never lets two racing writers both win, refusals as `PluginResult` failures). Each bundled plugin runs its suite: `packages/store-local/test/unit/contract.test.ts`, `packages/store-refs/test/integration/contract.test.ts`, `packages/tracker-local/test/unit/contract.test.ts`, `packages/plugin-github/test/unit/contract.test.ts`, `packages/forge-none/test/unit/contract.test.ts`. Reference implementations in memory sit in `packages/conformance/test/unit/reference/`.
- `harnessConformance` replays a recording of each scenario in one catalogue through the harness's `normalize` into the kernel's reducer and classifier, and asserts the read each capability implies. It reads `capabilities`, never `name`. The recordings are in `packages/conformance/test/unit/fixtures/`, run by `packages/conformance/test/unit/claude.test.ts` and `packages/conformance/test/unit/pi.test.ts`.
- The live canary, `packages/conformance/test/integration/live-canary.test.ts`, runs one real headless turn per harness and replays its hook calls the same way. It starts a real agent and costs money, so it runs only with `NORN_TEST_LIVE=1`, never in CI.

A new plugin gets a contract run; a known break is listed in the suite's options with its reason, and fixing it means removing the entry.

## Where the contracts live

- **The plugin contract**: `packages/plugin-api/src/`. `plugin.ts` (`defineNornPlugin`, `PluginProvides`, the checks a plugin passes when it loads), one file per slot (`harness.ts`, `tracker.ts`, `forge.ts`, `store.ts`, `vcs.ts`, `runner.ts`, `step-kind.ts`, `pack.ts`), `host.ts` (`HostContext`), `result.ts` (`PluginResult`, `ok`, `fail`), `events.ts` (the normalized harness events the kernel reads), `story-key.ts`, `version.ts` (`PLUGIN_API_VERSION`, `apiSatisfies`). A slot joins as an optional member, so a plugin written against an older plugin API stays valid.
- **The kernel's model**: `packages/kernel/src/model/`. `facts.ts` (`KernelFacts`, what a tick gathers), `actions.ts` (`Decision` and every action kind), `receipts.ts` (every receipt kind), `run-state.ts`, `session.ts`, `config.ts` (`KernelConfig`, the counter defaults), `capabilities.ts` (what the configured slots can do, as decide sees it).
- **decide**: `packages/kernel/src/decide/`. `index.ts` (entry), `story.ts` (intake, claims, the story's tail: flush, finish, release), `unit.ts` with `unit-agent.ts` and `unit-steps.ts`, `rules.ts` (`RULE_IDS`).
- **The journal**: `packages/kernel/src/journal/`. `journal.ts` holds the write rules (receipts before effects, state last by compare-and-swap, a lost race read again, anything failing validation read as corrupt); `apply.ts` turns receipts into run state; `format.ts` reads older run-state formats forward.
- **Workflows**: `packages/kernel/src/workflow/`. `load.ts` (the loader and its refusals), `counters.ts` (derived counters), `flatten.ts` (`use` and `like`), `steps.ts` (head keys and step kinds).
- **Persisted formats and ids**: `packages/schema/src/*.ts`, `packages/schema/src/ids.ts` (`ulid`, `deriveUlid`, keys, slugs, `parseDuration`). Validate with `validate(name, value)` / `assertValid(name, value)`; never hand-roll checks of these shapes.
- **The config**: `packages/cli/src/config/schema.ts` (`NornConfig`, `ConfigLayer`, `CONFIG_DEFAULTS`), `packages/cli/src/config/paths.ts` (the layers and their files, the plugin lock), `packages/cli/src/config/derive.ts` (the kernel's and runtime's config from the person's). The norn home (`NORN_HOME_DIR`, else `~/.norn`) and the machine dir `~/.norn/repos/<id>/`, keyed by git's common dir: `packages/cli/src/home.ts`.
- **What an agent finds in its worktree**: `packages/runtime/src/inputs.ts` (the spec, the handoff and the other inputs under `.agents/`), `packages/runtime/src/skills.ts` (pack skills in `.agents/skills/`, linked from the harness's folder), `packages/runtime/src/story-docs.ts` (the spec and handoffs kept as store artifacts).

Change a contract only together with its tests, its conformance suite and every user of it.

## Code rules

[`AGENTS.md`](../AGENTS.md#rules) has them in short; here they are in full.

- **Glossary** (definitions in [Concepts](concepts.md#glossary)). Use the core nouns: story, slice, unit, workflow, step, run, claim, receipt, outcome, counter, gate, check, handoff, brief, tick, mode, worktree, plugin, slot, pack, harness, runner, executor, trace, mailbox. Banned synonyms: `task`/`job`/`ticket` → story/slice; state (for a workflow node) → step; lease (for ownership) → claim; result/status (for how a step ended) → outcome; `interactive step` → attended step. Outcomes are spelled as typed (`approve`, never `approved`). `test/repo/repo.test.ts` lints the unambiguous ones in package sources, `packages/pack-sdlc/assets`, `packages/schema/json` and every doc (the README, `CONTRIBUTING.md`, `docs/`, `AGENTS.md`). It matches whole words only and skips URLs, and in docs (not `.ts`) it skips inline code spans, so quote a banned word in backticks only when naming it on purpose.
- **Machine contract is JSON + exit codes.** Every CLI command prints one JSON value on stdout with `--json`, markdown without it. Failures and refusals print a `CliError` `{error, do_instead, code?}` and exit with an `ExitCode` (`refused` = 3 when a rule says no). No prose in JSON output; human hints go in `do_instead`. Never parse prose (handoffs, spec bodies) in decide.
- **Receipts before effects, state last.** Receipts are immutable and numbered; the journal writes the receipt of an effect before the effect, and commits the unit's state last, by compare-and-swap, as the commit point. A commit that lost a race is read again, never forced. Every record is validated on read; one that fails makes the unit `corrupt`, never a guess or a fresh start.
- **One IO boundary.** `@norn/host-node` builds the `HostContext`, and only it writes files (temp file → fsync → rename) or starts processes. The two harness plugins write the agent tool's own config file the same way, temp → fsync → rename; that is the one allowlisted exception.
- **The kernel is pure.** No `node:fs`, `Bun.spawn`, `Date.now()` or `Math.random` in `@norn/kernel`; use `facts.now` and `deriveUlid(tick_id, i)`, so a golden case replays exactly. The journal is the kernel's only IO, and only through the `Store`.
- **Plugins never decide.** A plugin reports facts and performs one effect per call, idempotent by its receipt id. A step kind performs and reports an outcome; the host records it as a receipt and decide picks the next step.
- **Comments say why, never what or when.** Write one only for what the code cannot say: an invariant, an ordering that must hold, a hazard, why the obvious way is wrong. No issue numbers, spec item ids or history in comments; that lives in the PR and the spec folder.
- **Code style.** TypeScript strict ESM, `.ts` import suffixes inside a package, `@norn/<pkg>` across packages, no default exports, small modules. Tests sit in their tier's folder (see [Test tiers and CI](#test-tiers-and-ci)).
- **No run state in the repo.** Do not commit trace data or run state: both live outside the repo, in the checkout's machine dir `~/.norn/repos/<id>/` (or on the store's refs).

## Process

norn develops norn. The person's side of the loop is in [`CONTRIBUTING.md`](../CONTRIBUTING.md#the-loop); the rules an agent must follow are in [`AGENTS.md`](../AGENTS.md#process). The detail behind them:

- **Where an agent changes the repo.** Only inside a norn step: after `norn brief`, in that unit's worktree. An ad-hoc session reads, explores, discusses and drafts issues; it never commits or creates a branch. To hand work over, the person runs `/issue`. Exceptions, each only when the person asks: the bypass and the one-time bootstrap.
- **The CI process check** (`scripts/process-check.ts`) passes a PR only from a story branch `norn/gh-N` (or `gh-N-<slug>`, the one older releases open) that closes #N, a valid bypass, or Dependabot, and refuses one that edits the skill copies `.agents/skills/norn*` unless it is a release PR (titled `Release X.Y.Z`).
- **What a step may change.** Inside a step, `.agents/workflows/` and the norn config files are ordinary repo files a story may change. A running unit keeps its pinned workflow; norn validates workflows when it loads them, and `norn doctor` shows the problems. Only norn's run state (in the machine dir or the store's refs, never in the worktree) is off limits. The spec and the unit's handoff are the files under `.agents/specs/<story>/` in the worktree: the agent edits them there and norn reads them back when it reports.
- **Released binary vs code under change.** The process (`norn brief`, `norn done`, hooks, `watch`) always runs the latest released `norn`, never a build of this repo. To exercise your change, run `bun packages/cli/src/main.ts …`, never `norn …`, and only in a throwaway git repo under `$TMPDIR` with its own `NORN_HOME_DIR`. A unit worktree is a live norn unit, and a dev build run there would act on its claim and run state. A broken release: the person reinstalls the previous release binary; the fix goes through the bypass if norn cannot deliver it.
- **Workflows.** A story runs the workflow its issue label `norn:wf:<name>` names, else the config's default. The shipped ones are in `packages/pack-sdlc/assets/workflows/`; this repo's own, with its check commands and its CI wait, are in `.agents/workflows/`, each replacing the pack's file of the same name, plus `release`.
- **Changelog.** Do not edit `CHANGELOG.md` in a PR. The `release` step writes it from the squash commits (see [Decisions](#decisions)).
- **The bypass, from an agent's side.** Only when the person asks, and only when norn cannot deliver the change. The person opens an issue labelled `bypass` that links the norn issue for the norn problem behind it. Work on branch `bypass/<issue>-<slug>`; the PR is labelled `bypass` and says `Closes #<bypass issue>`.
- **Friction.** When norn gets in the way while working here, say so in the handoff; the person files it with `/issue` and the `friction` label.

## Skills

- **Bundled skills.** The pack's skills are in `packages/pack-sdlc/assets/skills/`: edit them there. `.agents/skills/norn*` are this repo's committed copies, refreshed by the release step; never edit a copy.
- **Repo-local skills.** Skills without the `norn-` prefix (`release`, `release-start`, `issue`) are repo-local: edit them in place in `.agents/skills/<name>/SKILL.md` (linked from `.claude/skills/<name>`). `issue` and `release-start` are person-only (`disable-model-invocation: true`); an agent never runs them.
- **Exact or principled.** A bundled skill is exact in two places only: where code reads what the agent produces (report outcomes, the criteria and findings JSON, a file's fixed layout), because a reworded field breaks the reader; and where it is tuned to the agent tool (such as `norn-fsd-round`'s timeouts), because the number comes from how the tool behaves, not from judgement. Everywhere else a skill states the failure it prevents and the outcome to reach, and gives principles with their reasons, so the model can fit the work to the change in front of it; it keeps numbered steps only where order matters (check earlier findings before the diff, verify a finding before deciding). A fixed prompt to paste into a subagent or a word cap is procedure in place of judgement: say what the subagent must cover and why instead.
- **The `norn` skill** stays short and holds no workflow logic or step names: the brief carries the process, step skills carry the craft.

## Releases

A person runs `/release-start`. It opens the release issue. The `release` workflow rebuilds `CHANGELOG.md` from the squash commits since the last tag, bumps `version` in `packages/cli/package.json` and the README release badge, refreshes `.agents/skills/norn*` from `packages/pack-sdlc/assets/skills/`, opens the PR and waits for its CI. The person judges the version and the changelog at `ready`. Merging that PR smokes every binary on its own OS, tags `vX.Y.Z` and publishes in one CI run. See [Process](#process), and the decisions on publishing and the changelog below.

## Decisions

Deliberate choices that diverge from the obvious design.

- **A thin kernel, everything else a plugin.** The kernel holds only what must be the same for every repo: the workflow model, decide, the journal's write rules and the session reducer. Where stories come from, where changes are reviewed, where run data lives, which agent tool runs and where it runs are slots, so a repo with no code host (tracker `local`, forge `none`) and a team on GitHub run the same kernel. The bundled plugins ship in the binary; `norn plugin add` installs others into `~/.norn/plugins/` and pins them in a lock.
- **One package per plugin.** Each bundled plugin is its own package that reads only `schema` and `plugin-api`, so the dependency lint proves a bundled plugin uses nothing a third-party one could not.
- **The committed config wins.** The layers merge as built-in defaults, then `~/.norn/config.yaml`, then `.agents/norn.local.yaml`, then `.agents/norn.yaml`, the last one winning. A team that commits its config (`norn init --commit`) gets the same tracker, forge, store and workflows on every machine; a key it leaves unset is still each person's.
- **The spec and handoffs live with the run data, not on the branch.** A story's documents are store artifacts. Before a launch, and whenever `norn brief` renders, norn writes them into the worktree under `.agents/specs/<story>/` (and every other input under `.agents/inputs/`), each folder with a `.gitignore` of `*`, and reads back what the agent changed when it reports. A PR then holds only code, and nothing the agent reads is ever committed by accident.
- **Pack skills are written before every launch.** Each pack skill goes to `.agents/skills/<name>/` in the worktree, ignored by git, and the harness's own folder (`.claude/skills/`, `.pi/skills/`) gets a link to it. A folder of that name the repo commits itself carries no norn mark and is left alone, so a repo overrides a pack skill by committing its own.
- **The main checkout gets the same skills from doctor.** A person runs `/norn-fsd`, `/norn-retro` and `/norn-triage` in their own session, which no launch reaches, so doctor's `skills` check (which init runs) writes the same marked copies and links into the main checkout and brings them up to date on each run, removing norn's copies, files and links of skills a newer pack dropped (the checkout outlives an upgrade, a unit worktree does not). This repo's committed `.agents/skills/norn*` copies carry no mark and stay as the release step left them.
- **Hooks go in the agent tool's local settings only.** The claude harness writes `.claude/settings.local.json` in each worktree at launch, never the committed `settings.json`, so a machine-specific hook command never follows the branch into a clone where it does not exist. A marked `.claude/.gitignore` beside it names the file and itself, so the worktree stays clean for a branch update and an agent's `git add -A` never commits the hooks; a `.claude/.gitignore` without norn's mark is the repo's and is never rewritten.
- **Claude sessions run in `auto` permission mode by default.** Permission profiles per step are not built ([Limitations](limitations.md)). A permission prompt parks the unit (`agent.permission.park`, its text naming the call from the pending `tool.requested`), and `story answer` records the answer `to: dialog`, which the tick turns into the harness's `dialogKeys` pressed through the runner's `keys` (plugin API 1.12), only while the run's events still show that prompt open. A run alive in a pane that sends no event for the silent window (its hooks never loaded, as behind a trust prompt) parks as `agent.no_events.park` rather than being retried into the same prompt in a fresh pane. A runner that can read its pane offers `dialog` (plugin API 1.15; herdr reads the screen while it reports the agent `blocked`): the tick reads it for a live run with no event yet (`run_dialog`), and decide parks on it at once with the dialog's text, so the silent window is only the fallback for a pane nobody can read. The claude harness's default args are `--permission-mode auto` (`DEFAULT_ARGS`); an executor's `args` replaces them whole, permission mode included.
- **Published as `@pruszynskijakub/norn` on GitHub Packages.** The workspace package stays `@norn/cli`; GitHub's npm registry only takes a package under its owner's scope, so the release build renames it (`bun scripts/build.ts --name … --registry …`). The packs and harnesses import their assets as text, so the bundle and the binary carry every workflow, skill and extension. Merging the release PR runs one CI workflow that creates tag `vX.Y.Z`, tests, publishes the package and attaches the binaries to a GitHub release. Tag and publish share one run because a tag pushed with `GITHUB_TOKEN` triggers no other workflow.
- **The store keeps a norn version floor, not the config.** Receipt and state shapes grow with norn, and an older norn reads a newer shape as invalid and marks the unit corrupt, so every norn acting on one store must be at least as new as the newest that wrote it. A store may offer `floor` (plugin API 1.13): `local` keeps it in `runs-v2/floor.json`, `refs` on `refs/norn/v2/floor`, pushed under a lease like a claim. A command marked `acts` checks the floor when it first builds its runtime env (`packages/cli/src/version-guard.ts`): below it, it refuses with `version_too_old` (exit 3) before it writes anything; above it, it raises the floor to its own release before it acts, so no write of a newer norn reaches an older one that was not refused first. A pre-release or dev build compares as the release it leads to; a build that names no version (only a test passes one) is never checked; a floor the store cannot read or raise is noted on stderr and lets the command act, so an offline `refs` clone still ticks. Read-only commands, `init`, `config`, `plugin` and `hook` are not checked, so a person can still see a story and fix a setup; `watch` checks before each tick and pauses with one `paused` line. The floor rises on any newer release, not only one that changed a shape: telling the two apart would need every shape change to carry its own version, and a missed one is a corrupt unit. The old `norn_version` config key is gone: it held a version a person had to bump by hand and commit.
- **The machine dir is keyed by git's common dir.** Every worktree of one clone, a unit's included, shares `~/.norn/repos/<id>/`, and two clones never do, so two clones on one machine are two holders of a claim.
- **norn develops norn (self-hosting).** Every change to a file in the repo starts as a norn issue and lands through a norn workflow; an agent changes the repo only inside a norn step (see [Process](#process)). Outside norn: Dependabot PRs, GitHub settings, backlog triage, the bypass, and the one-time bootstrap. Enforced by these docs and the CI process check, not by an editor hook.
- **Squash-only merges; the changelog is written at release.** Every merge to `main` is a squash whose message is the PR title and description, so each commit is one PR (`Closes #N`). PRs do not edit `CHANGELOG.md` and there is no `## [Unreleased]` section: the `release` step writes `## [X.Y.Z] - <date>` from the commits since the last tag.
