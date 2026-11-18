# norn — agent guide

The map for an agent in this repo: the commands, the rules every change follows, and where the rest is. The person's side of contributing is [`CONTRIBUTING.md`](CONTRIBUTING.md); users read the [README](README.md) and [`docs/`](docs/). The contributor reference is [`docs/development.md`](docs/development.md): test tiers and CI, the plugin contract and its conformance suites, golden cases, releases, and the design decisions. Read the part your change touches.

## Commands

```sh
bun install
bun run test        # the unit tier, in seconds: your loop after each change; the lints run inside it
bun run typecheck   # tsc --noEmit over every package
bun run test:integration  # the integration tier: CI runs it, never a local check
bun run schema:emit # after changing a schema
bun run docs:emit   # after changing a command, flag or config key, or the pack's workflows
bun run golden -- --update  # after an intended change in what decide decides; review the diff
```

**Commit only when `bun run test` and `bun run typecheck` are green.** The unit tier (`bun run test`) and the type check must pass before you hand work back. There is no `bun run lint`: the lints run inside the unit tier. To run one package's integration tests: `bun test --config=bunfig.integration.toml --timeout=60000 packages/<pkg>`. Every command and what each tier runs: [Development › Commands](docs/development.md#commands) and [test tiers](docs/development.md#test-tiers-and-ci).

**Before writing a test, read `test/support/` and the support file of the package you test**: `packages/conformance/src/fakes.ts` (in-memory host, scripted exec, clocks), `packages/cli/test/unit/support.ts` (the cli in-process), `packages/runtime/test/unit/support.ts` (ticks over fakes). Take ref names and shapes from the code, never by hand ([Writing a test](docs/development.md#writing-a-test)). Golden cases change only for an intended behaviour change: [Development](docs/development.md#golden-cases).

## Layout and dependency direction

```
packages/schema           @norn/schema           JSON Schemas (TypeBox), types, ajv validators, ids
packages/plugin-api       @norn/plugin-api       the plugin contract: slots, HostContext, PluginResult, events, story keys
packages/kernel           @norn/kernel           pure: workflow loader, decide, journal rules, session reducer, brief
packages/runtime          @norn/runtime          the host around the kernel: tick, act, launcher, hooks, the mount table, overlay rule and ownership mark, forge step kinds
packages/host-node        @norn/host-node        the one IO boundary: files (atomic writes), exec, detached processes
packages/vcs-git          @norn/vcs-git          vcs over git: worktrees, merge, push; step kinds update-branch, integrate, push, verify-base
packages/tracker-local    @norn/tracker-local    tracker: items as markdown files
packages/plugin-github    @norn/plugin-github    tracker (issues) and forge (pull requests) through gh
packages/forge-none       @norn/forge-none       forge for a repo without a code host
packages/store-local      @norn/store-local      store: run data in the machine dir
packages/store-refs       @norn/store-refs       store: run data on git refs shared through the remote
packages/harness-claude   @norn/harness-claude   harness: Claude Code (hooks, launch, events)
packages/harness-pi       @norn/harness-pi       harness: pi (extension, launch, events)
packages/runner-headless  @norn/runner-headless  runner: the agent as a detached process
packages/runner-herdr     @norn/runner-herdr     runner: the agent in a Herdr pane
packages/pack-sdlc        @norn/pack-sdlc        pack: the shipped workflows, shared files and skills
packages/conformance      @norn/conformance      contract suites for the slots, in-memory fakes, recorded-session replay
packages/cli              @norn/cli              wiring + commands, config layers, plugin install; bin `norn` → src/main.ts
```

Dependencies point one way only: `schema ← plugin-api ← kernel ← runtime ← cli`. Every plugin package (`host-node`, `vcs-git`, `tracker-local`, `plugin-github`, `forge-none`, `store-local`, `store-refs`, `harness-claude`, `harness-pi`, `runner-headless`, `runner-herdr`) reads only `schema` and `plugin-api`; `pack-sdlc` reads only `plugin-api`; `conformance` adds `kernel`; `cli` wires them all. `test/repo/repo.test.ts` enforces it: every `@norn/*` import must be allowed **and** declared in the package's `package.json`. Each package in full: [Development › Layout](docs/development.md#layout).

## Process

- **Hard rule.** Change the repo only inside a norn step: after `norn brief`, in that unit's worktree. An ad-hoc session reads, explores, discusses and drafts issues; it never commits or creates a branch (the person runs `/issue` to hand work over). The bypass and the one-time bootstrap happen only when the person asks. Inside a step, of the repo's files only norn's run state is off limits (`.agents/workflows/` and the norn config are ordinary files), and the brief's rules have the rest; keep the unit's handoff current (the brief names its file under `.agents/specs/<story>/handoffs/`).
- **Released binary vs code under change.** `norn brief`, `norn done`, hooks and `watch` run the released `norn`. To exercise your change run `bun packages/cli/src/main.ts …`, never `norn …`, and only in a throwaway git repo under `$TMPDIR` with its own `NORN_HOME_DIR`: a unit worktree is a live norn unit, and a dev build there would act on its claim and run state.
- **Only a person decides a gate or answers a question** (`norn story approve`, `norn story reject`, `norn story answer`), and only a person merges a PR.
- **Only a person moves a story between machines** (`norn story take gh-N [--force]`): a tick never takes another holder's claim, even an expired one.
- **Only a person starts the next round** (`norn story round gh-N --workflow <name> [--at <step>]`), and a new round is for new work on a story whose change has not merged: once it merged, new work is a new story. A finished story whose PR conflicts with its base or lags it is updated with `norn story update-branch gh-N`; a conflict there is refused, and resolved by a round at the workflow's update step.
- **Bundled copies.** Edit a bundled skill in `packages/pack-sdlc/assets/skills/`, never its `.agents/skills/norn*` copy. A shipped workflow lives in `packages/pack-sdlc/assets/workflows/`; `.agents/workflows/` holds this repo's own files, each replacing the pack's file of the same name. Never run the person-only skills `issue` and `release-start`.
- **Never edit `CHANGELOG.md`.** The release step writes it.
- **Friction.** When norn gets in the way, say so in one line under the handoff's Notes. The rest of the process: [Development › Process](docs/development.md#process).

## Rules

- **Glossary** ([Concepts](docs/concepts.md#glossary)). Use the core nouns: story, slice, unit, workflow, step, run, claim, receipt, outcome, counter, gate, check, handoff, brief, tick, mode, worktree, plugin, slot, pack, harness, runner, executor, trace, mailbox. Not `task`/`job`/`ticket` (story/slice), state for a workflow node (step), lease for ownership (claim), result/status for how a step ended (outcome), `interactive step` (attended step). Outcomes are spelled as typed (`approve`, never `approved`). Linted in docs and sources; quote a banned word in backticks only when naming it on purpose.
- **Machine contract is JSON + exit codes.** With `--json` every command prints one JSON value; a refusal prints a `CliError` `{error, do_instead, code?}` and exits with an `ExitCode` (`refused` = 3). Without it, commands print markdown. No prose in JSON (hints go in `do_instead`); never parse prose (handoffs, spec bodies) in decide.
- **Receipts before effects, state last.** The kernel's journal writes every receipt before the effect it records and commits a unit's state last, by compare-and-swap, as the commit point; a commit that lost a race is read again, never forced. Every record is validated on read; one that fails makes the unit `corrupt`, never a guess.
- **One IO boundary.** Only `@norn/host-node` writes files and starts processes, behind the `HostContext` every plugin receives; its writes are atomic (temp file, fsync, rename). Every JSON read is validated against a schema.
- **The kernel is pure; plugins never decide.** No `node:fs`, `Bun.spawn`, `Date.now()` or `Math.random` in `@norn/kernel`; use `facts.now` and `deriveUlid`. A plugin reports facts and performs one effect per call; a step kind performs and reports, and never picks the next step.
- **Comments say why, never what or when**: an invariant, an ordering that must hold, a hazard. No issue numbers, spec item ids or history.
- **Code style.** TypeScript strict ESM, `.ts` import suffixes inside a package, `@norn/<pkg>` across packages, no default exports, small modules; tests in their tier's folder, never in `src/`. Never commit trace data or run state. The rules in full: [Development › Code rules](docs/development.md#code-rules).

## Where the contracts live

- The plugin contract: `packages/plugin-api/src/`. One file per slot (`harness.ts`, `tracker.ts`, `forge.ts`, `store.ts`, `vcs.ts`, `runner.ts`, `step-kind.ts`, `pack.ts`), `plugin.ts` (`defineNornPlugin`, `PluginProvides`), `host.ts` (`HostContext`), `result.ts` (`PluginResult`), `events.ts` (normalized harness events), `version.ts` (the plugin API version).
- Persisted formats and ids (validate with `assertValid`, never by hand): `packages/schema/src/*.ts`; ids, names and refs in `packages/schema/src/ids.ts`.
- The kernel's model: `packages/kernel/src/model/` (`facts.ts`, `actions.ts`, `receipts.ts`, `run-state.ts`, `config.ts`). decide itself: `packages/kernel/src/decide/`. The journal's write rules: `packages/kernel/src/journal/journal.ts`. Workflow loading and counters: `packages/kernel/src/workflow/`.
- The config a person writes and its layers: `packages/cli/src/config/schema.ts` and `packages/cli/src/config/paths.ts`, the layers resolved by the runtime's overlay (`packages/runtime/src/overlay.ts`), as the repo's workflows over the pack are; the norn home and the machine dir: `packages/cli/src/home.ts`. Where a worktree's inputs, skills and hooks go: the mount table, `packages/runtime/src/mount.ts`, under the ownership marks of `packages/runtime/src/ownership.ts`.
- Change a contract only together with its tests, its conformance suite and every user of it. What each file holds: [Development](docs/development.md#where-the-contracts-live).

## Gotchas

- zsh does not word-split an unquoted variable: use an array (`${=branches}`) or `xargs`.
- Bun's `toMatchObject` can mutate the value it matches: match a `structuredClone` copy, or compare fields with `toEqual`.
- Run `norn done` from the unit worktree's root: reporting can remove or move the directory you stand in.
- A wait pattern matches a full status token, never a bare `done` (it also matches `sync.done`, `$done`, `not done`): anchor it (`grep -x`, `-w`, the JSON field's exact value).
