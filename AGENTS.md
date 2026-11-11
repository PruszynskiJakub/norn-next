# norn — agent guide

The map for an agent in this repo: the commands, the rules every change follows, and where the rest is. The person's side of contributing is [`CONTRIBUTING.md`](CONTRIBUTING.md); users read the [README](README.md) and [`docs/`](docs/). The contributor reference is [`docs/development.md`](docs/development.md): test tiers and CI, golden cases, effect transcripts, observe snapshots, port contract suites, releases, and the design decisions (such as `heartbeat_id` per checkout). Read the part your change touches.

## Commands

```sh
bun install
bun run test        # the unit tier, in seconds: your loop after each change; the lints run inside it
bun run typecheck   # tsc --noEmit over every package
bun run test:e2e    # the e2e tier runs in CI; `bun run test:e2e <file>` runs one file (e.g. to rewrite its transcript)
bun run test:integration  # the integration tier: CI runs it, never a local check
bun run schema:emit # after changing a schema
bun run docs:emit   # after changing a command, flag, config key or shipped workflow
bun run golden -- --update  # after an intended change in what decide decides; review the diff
```

**Commit only when `bun run test` and `bun run typecheck` are green.** The unit tier (`bun run test`) and the type check must pass before you hand work back. There is no `bun run lint`: the lints run inside the unit tier. Every command and what each tier runs: [Development › Commands](docs/development.md#commands) and [test tiers](docs/development.md#test-tiers-and-ci).

**Before writing a test, read `test/support/`** (`test/support/harness.ts` is the cli harness). Take ref names and shapes from the code, never by hand ([Writing a test](docs/development.md#writing-a-test)). Pinned outputs (golden cases, transcripts, snapshots) change only for an intended behaviour change: [Development](docs/development.md#golden-cases).

## Layout and dependency direction

```
packages/schema    @norn/schema    JSON Schemas (TypeBox), types, ajv validators, ids, config merge
packages/core      @norn/core      pure logic: ports, Facts, Action, decide, briefing; no IO
packages/store     @norn/store     every file and ref norn writes: run state, handoffs, claims, mailbox, leases, worktrees, the machine dir
packages/adapters  @norn/adapters  one subfolder per adapter (git, gh, glab, herdr, headless, claude, codex, opencode, gemini, notify, process)
packages/view      @norn/view      read model loadProjectView()
packages/cli       @norn/cli       wiring + commands; bin `norn` → src/main.ts
```

Dependencies point one way only: `schema ← core ← store ← adapters ← cli`; `view` depends on `schema`, `core`, `store`; `cli` may use `view`. `test/repo/repo.test.ts` enforces it: every `@norn/*` import must be allowed **and** declared in the package's `package.json`. Each package in full: [Development › Layout](docs/development.md#layout).

## Process

- **Hard rule.** Change the repo only inside a norn step: after `norn brief`, in that unit's worktree. An ad-hoc session reads, explores, discusses and drafts issues; it never commits or creates a branch (the person runs `/issue` to hand work over). The bypass and the one-time bootstrap happen only when the person asks. Inside a step, of the repo's files only norn's run state is off limits (`.agents/workflows/` and the norn config are ordinary files), and the brief's How to work has the rest; keep the unit's handoff (`handoffs/<unit>.md` in its spec folder) current.
- **Released binary vs code under change.** `norn brief`, `norn done`, hooks and `watch` run the released `norn`. To exercise your change run `bun packages/cli/src/main.ts …`, never `norn …`, and only in a throwaway git repo under `$TMPDIR`: a unit worktree is a live norn unit, and a dev build there would act on its claim and run state.
- **Only a person starts the next round** (`norn story edit gh-N --workflow <name> [--at <step>]`), and a new round is for new work: a finished story whose PR conflicts with its base is updated with `norn story update-branch gh-N`.
- **Bundled copies.** Edit a bundled skill in `packages/cli/assets/skills/`, never its `.agents/skills/norn*` copy. Change a shipped workflow in both `packages/cli/assets/workflows/` and `.agents/workflows/`. Never run the person-only skills `issue` and `release-start`.
- **Never edit `CHANGELOG.md`.** The release step writes it.
- **Friction.** When norn gets in the way, say so in one line under the handoff's Notes. The rest of the process: [Development › Process](docs/development.md#process).

## Rules

- **Glossary** ([Concepts](docs/concepts.md#glossary)). Use the core nouns: story, slice, unit, workflow, step, run, claim, receipt, outcome, counter, gate, check, handoff, brief, inbox, tick, mode, worktree, slot, trace, mailbox. Not `task`/`job`/`ticket` (story/slice), state for a workflow node (step), lease for ownership (claim; machine slot files *are* leases), result/status for how a step ended (outcome), `interactive step` (attended step). Outcomes are spelled as typed (`approve`, never `approved`). Linted in docs and sources; quote a banned word in backticks only when naming it on purpose.
- **Machine contract is JSON + exit codes.** With `--json` every command prints one JSON value; a refusal prints a `CliError` `{error, do_instead, code?}` and exits with an `ExitCode` (`refused` = 3). Without it, commands read by an agent or a person print markdown. No prose in JSON (hints go in `do_instead`); never parse prose (handoffs, spec bodies) in decide.
- **Atomic writes, receipts before effects, state last.** Every file norn writes goes through store (temp file, fsync, rename). Every JSON read is validated against `@norn/schema`; a failing file makes the unit `corrupt`, never a guess. Receipts are immutable and numbered; `state.json` is written last and is the commit point.
- **Core is pure; ports never decide.** No `fs`, `Bun.spawn`, `Date.now()` or random ids in `@norn/core`; use `facts.now` and `deriveUlid(facts.tick_id, i)`. Adapters report facts and perform one effect each.
- **Front ends read through `@norn/view` and act through CLI verbs**, never reading run state or calling store directly.
- **Comments say why, never what or when**: an invariant, an ordering that must hold, a hazard. No issue numbers, spec item ids or history.
- **Code style.** TypeScript strict ESM, `.ts` import suffixes inside a package, `@norn/<pkg>` across packages, no default exports, small modules; tests in their tier's folder, never in `src/`. Never commit trace data or run state. The rules in full: [Development › Code rules](docs/development.md#code-rules).

## Where the contracts live

- Persisted formats (validate with `assertValid`, never by hand): `packages/schema/src/*.ts`. Ids, names and refs: `packages/schema/src/ids.ts`. Paths and the machine dir: `packages/store/src/paths.ts`.
- Adapter ports: `packages/core/src/ports.ts`. Observe output (`Facts`): `packages/core/src/facts.ts`. Decide output (`Action`, `Decision`): `packages/core/src/actions.ts`. decide itself: `packages/core/src/decide/`.
- Change a contract only together with its tests and every user of it. What each file holds: [Development](docs/development.md#where-the-contracts-live).

## Gotchas

- zsh does not word-split an unquoted variable: use an array (`${=branches}`) or `xargs`.
- Bun's `toMatchObject` can mutate the value it matches: match a `structuredClone` copy, or compare fields with `toEqual`.
- Run `norn done` from the unit worktree's root: reporting can remove or move the directory you stand in.
- A wait pattern matches a full status token, never a bare `done` (it also matches `sync.done`, `$done`, `not done`): anchor it (`grep -x`, `-w`, the JSON field's exact value).
