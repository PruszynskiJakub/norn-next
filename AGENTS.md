# norn — contributor and agent guide

The spec is `.agents/PRD.md`. Read it before changing behaviour; cite its ids (S5, W4, C1, …) in code comments where a rule is enforced.

## Commands

```sh
bun install
bun test            # all tests (packages/*/test, test/)
bun run typecheck   # tsc --noEmit over every package
bun run schema:emit # regenerate packages/schema/json/*.schema.json after changing a schema
```

To release: bump `version` in `packages/cli/package.json` and the release badge in `README.md`, run `bun run sync:plugin` (the Claude Code plugin carries the same version), move `## [Unreleased]` entries in `CHANGELOG.md` under `## [X.Y.Z] - <date>`, merge, then `git tag vX.Y.Z && git push origin vX.Y.Z`.

All three must pass before you hand work back; CI (`.github/workflows/ci.yml`) runs them on every PR, then builds the npm package and a binary and runs `scripts/smoke.sh` on each; a release also smokes each binary on its own OS (macOS arm64/x64, Linux arm64). A test fails if the emitted JSON schemas are stale.

## Layout and dependency direction

```
packages/schema    @norn/schema    JSON Schemas (TypeBox) + types + ajv validators, ids, config merge
packages/core      @norn/core      pure logic: ports (adapter interfaces), Facts, Action, decide, briefing — no IO
packages/store     @norn/store     .agents/ files, runs/ JSON, claim + mailbox refs, ~/.norn leases
packages/adapters  @norn/adapters  src/{git,gh,glab,herdr,headless,claude,codex,opencode,gemini,notify}
packages/view      @norn/view      read model loadProjectView()
packages/cli       @norn/cli       wiring + commands; bin `norn` → src/main.ts
```

Dependencies point one way only: `schema ← core ← store ← adapters ← cli`; `view` depends on `schema`, `core`, `store`; `cli` may use `view`. `test/repo.test.ts` enforces this — every `@norn/*` import must be allowed **and** declared in the package's `package.json`. Bun's isolated linker also hides undeclared packages.

**Simplification vs PRD §17:** the PRD lists one package per adapter (`@norn/adapter-git`, …). We ship one `@norn/adapters` package with a subfolder per adapter, each exported as a namespace (`import { claude } from "@norn/adapters"`). Third-party adapters still implement the interfaces in `packages/core/src/ports.ts` (X2). Split later only if distribution needs it.

## Decisions (deliberate divergences from the PRD)

- **One adapters package (§17).** See "Simplification vs PRD §17" above: one `@norn/adapters` package with a subfolder per adapter instead of separate `@norn/adapter-*` packages.
- **Published as `@pruszynskijakub/norn` on GitHub Packages (X3, §17).** The workspace package stays `@norn/cli`; GitHub's npm registry only takes a package under its owner's scope, so the release build renames it (`bun scripts/build.ts --name … --registry …`). A tag `vX.Y.Z` runs `.github/workflows/release.yml`: it checks the tag against `packages/cli/package.json` and a `## [X.Y.Z]` section in `CHANGELOG.md`, tests, publishes the package and attaches the binaries to a GitHub release with that section as notes.
- **`heartbeat_id` is per checkout, not per `watch` process (ID2).** ID2 says one `heartbeat_id` per `watch` process. We keep one per checkout in `.agents/norn/trace/heartbeat.json` (created on first use, `packages/cli/src/runtime/local.ts`), shared by `watch` and every `tick`. Reason: ticks run from cron (or by hand) are separate processes; with a per-process id each one would see the claim it renewed a minute ago as someone else's heartbeat. One id per checkout lets every tick recognise its own claim.

- **Claude sessions run in `auto` permission mode by default (PRD §20).** The PRD defers permission management and surfaces every permission prompt as an implicit ask. The built-in config instead gives `agents.claude` `args: ["--permission-mode", "auto"]` (`DEFAULT_CONFIG`, `packages/schema/src/config.ts`), so unattended sessions in herdr or headless park far less often. A config layer that defines `agents.claude` replaces the entry, args included — set `args` there to keep or change the mode. The start command shown to a person (`startCommandFor`) carries the same args.
- **The R8.1 shim lives in norn's machine home, not under the launch env's `NORN_HOME` (SPEC-auto-mode-recovery R8.1).** The spec says `$NORN_HOME/bin/norn`, but the `NORN_HOME` an agent sees is the repo root (A6). The shim is `~/.norn/bin/norn` (`NORN_HOME_DIR`), one per machine, rewritten by each launch to exec the launching norn (`packages/cli/src/runtime/shim.ts`); `NORN_BIN` names it.
- **Commands read by an agent or a person print markdown (P8, B3).** P8 says every command prints one JSON value. Agents follow instructions better as markdown and people read a summary faster than JSON, so a command whose reader is an agent (`brief`, `done`, `ask`, `stuck`) or a person (`help`, `init`, `doctor`, `status`, `inbox`, `trace`) sets `markdown: true` and returns `rendered(value, markdown)`; its refusals print as markdown too. Every command takes `--json` and then prints the one JSON value P8 asks for (`CliError` on refusal), and the exit codes are the same either way, so code branches on the exit code and `--json` data, never on markdown. Commands a program reads (`tick`, `watch`, `hook`, `sync`, …) print JSON only. `runCli` picks the format (`packages/cli/src/cli.ts`); its `value` is always the data.
- **An answer from the mailbox is typed by the holder's tick (R6.3).** R6.3's "no answer receipt on a failed delivery" holds for `norn answer` on the checkout that holds the claim and runs the session: it types first and writes the receipt (`delivered: true`) only after. A mailbox answer already is a receipt; the holder's tick types it before writing state, so a failed delivery leaves the unit parked and the next tick tries again.

## Where the contracts live

- Persisted formats: `packages/schema/src/*.ts` — `Workflow`, `StoryFrontmatter`, `SliceFrontmatter`, `UnitState` (state.json), `Receipt` (14 kinds), `CriteriaReport` (`norn done --criteria`, QV2), `TraceEvent`, `HookFact`, `ClaimBlob`, `LeaseFile`, `ConfigLayer`/`ResolvedConfig`, `CliError`, `ExitCode`. Validate with `validate(name, value)` / `assertValid(name, value)`; never hand-roll checks of these shapes.
- Ids and names: `packages/schema/src/ids.ts` — `ulid`, `deriveUlid` (deterministic ids for pure decide), story/slice keys, `slugify`, branch/dir/ref names, receipt file names, `parseDuration`.
- Adapter ports: `packages/core/src/ports.ts`. Observe output: `packages/core/src/facts.ts` (`Facts`). Decide output: `packages/core/src/actions.ts` (`Action`, `Decision`, `ActionResult`) — its header defines the act ordering.

Change a contract only together with its tests and every user of it.

## Rules

- **Glossary (PRD §5).** Use the core nouns: story, slice, unit, workflow, step, run, claim, receipt, outcome, counter, gate, check, handoff, brief, inbox, tick, mode, worktree, slot, trace, mailbox. Banned synonyms: `task`/`job`/`ticket` → story/slice; state (for a workflow node) → step; lease (for ownership) → claim (machine slot files *are* leases); result/status (for how a step ended) → outcome; `interactive step` → attended step. Outcomes are spelled as typed (`approve`, never `approved`). `test/repo.test.ts` lints the unambiguous ones in package sources, `packages/cli/assets`, `plugins/`, `packages/schema/json`, `README.md` and this file — whole words only, URLs skipped, and in docs (not `.ts`) inline code spans skipped, so quote a banned word in backticks only when naming it on purpose.
- **Machine contract is JSON + exit codes (P8).** Every CLI command prints one JSON value on stdout with `--json` (commands read by an agent or a person print markdown without it: see Decisions). Failures/refusals print a `CliError` `{error, do_instead, code?}` and exit with an `ExitCode` (`refused` = 3 when a rule says no). No prose in JSON output; human hints go in `do_instead`. Never parse prose (`handoff.md`, spec bodies) in decide.
- **Atomic writes (S1).** Every file norn writes goes through store: temp file in the same dir → fsync → rename. Lease files are created with `O_EXCL`. Every JSON read is validated against `@norn/schema`; a failing file makes the unit `corrupt` (S2) — never guess or start over.
- **Receipts before effects (P6), state last (S5).** Receipts are immutable, numbered `NNNN-<kind>.json`; `state.json` is written last and is the commit point.
- **Core is pure.** No `fs`, `Bun.spawn`, `Date.now()` or random ids in `@norn/core`; use `facts.now` and `deriveUlid(facts.tick_id, i)` so `norn why` replays exactly.
- **Ports never decide.** Adapters report facts and perform one effect each.
- Code style: TypeScript strict ESM, `.ts` import suffixes inside a package, `@norn/<pkg>` across packages, no default exports, small modules. Tests sit in `packages/<pkg>/test/*.test.ts` (never in `src/`) and run with `bun test`; adapters are tested against recorded fixtures in `packages/adapters/test/<adapter>/{<adapter>.test.ts,fixtures/}`, core by replaying traces (X4). `test/repo.test.ts` enforces the layout.
- Do not commit generated trace data (`.agents/norn/trace/` is gitignored).
