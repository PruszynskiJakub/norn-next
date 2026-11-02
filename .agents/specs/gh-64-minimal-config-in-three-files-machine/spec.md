---
id: gh-64
slug: minimal-config-in-three-files-machine
provider: gh
number: 64
url: https://github.com/PruszynskiJakub/norn-next/issues/64
title: "Minimal config in three files: machine, you in this repo (config.local.yaml), the team"
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:refinement
workflow: refinement
status: new
intake_at: 2026-11-02T07:08:29.386Z
body_hash: 370f9e0ab73a2c566c1d86a8df111f353b89a83c1c1f1f5ff728d896fa778abe
---

## Observed

Config has 37 settable keys in two files that take the same schema (`ConfigLayer`, `packages/schema/src/config.ts`). Predicting what is in effect takes about nine rules: the repo file wins, except that machine caps take the lower value; `agents` entries replace the built-in whole; `notifiers` replaces as a list; `null` unsets. These were all reproduced with the CLI (0.9.x):

1. **Contradictory settings pass `config`, `doctor` and `status`:**
   - `claim: {lease: 1m, renew: 5m}`: the claim expires between renewals, so another machine can take a story mid-work.
   - `slots: {min: 5, max: 2}`: there is no slot, and every lease fails.
   - `default_agent: codex` with no `agents.codex`.
2. **Adapter `options` are untyped records.**
   - `runner: {adapter: herdr, options: {reuse_worskpace: true}}` is ignored without a word.
   - `notifiers: [{adapter: ntfy}]` passes validation, then `norn doctor` stops on `notifier ntfy: set option topic (or url)`, with no file named and no other checks run.
3. **Setting a model drops the permission mode.** `agents: {claude: {adapter: claude, model: …}}` replaces the built-in entry and loses `--permission-mode auto`. The `norn config` note only fires while that flag is still there.
4. **Adapter errors blame the wrong file.** They always say "fix .agents/norn/config.yaml", even for a value from `~/.norn/config.yaml` (`packages/cli/src/wiring.ts:47,50`).
5. **No schema an editor can use.** The template points at `packages/schema/json/config.schema.json`, which exists only in this repo, and `https://norn.dev/schema/config.json` does not resolve.
6. **No starting file, and no personal file for one repo.**
   - `norn init` never writes `~/.norn/config.yaml`.
   - Running one repo in auto mode, or with another model, means committing that for the whole team.
7. **Error and list wording.**
   - A typo is reported as **"Corrupt state (corrupt)"**.
   - Adding ntfy to `notifiers` drops `os`.

Also: `remote.host` is accepted and documented, but nothing reads it (its only mention is `packages/cli/src/commands/config.ts:77`).

## Wanted

A minimal config in three files. Each key is legal only in its own files, and every key is optional. A solo developer on GitHub with Claude Code writes nothing.

| File | For | Keys |
|---|---|---|
| `~/.norn/config.yaml` | this machine, and your defaults for every repo | machine: `max_agents`, `runner`, `notify` · yours: `mode`, `agent`, `agents.<name>` (`model`, `args`, `command`, `capabilities`, `adapter`) |
| `.agents/norn/config.local.yaml` (new, gitignored) | you, in this repo | `mode`, `agent`, `agents`: these override the user file |
| `.agents/norn/config.yaml` (committed) | the team | `provider`, `base_branch` |
| workflow files | step limits | per step, or a new workflow-level `defaults: {deadline, nudges, retries, stalled}` |

That is 14 keys, down from 37.

### The rules a person must know

1. **Machine keys live only in `~/.norn/config.yaml`.** The agent and port leases they govern (`~/.norn/leases/`, K3) are shared by every repo on the machine, so a per-repo value would not cap anything.
2. **Your keys** go in `~/.norn/config.yaml`, and `config.local.yaml` overrides them for one repo. The nearer file wins.
3. **Team keys live only in the repo file.** A key in the wrong file is refused with `config_wrong_file`, and the error names the right file.
4. **Maps merge key by key; lists and scalars replace.** Each agent merges field by field over the built-in entry, so setting `model` keeps `--permission-mode auto`. `notify` is a map, so adding ntfy keeps `os`.
5. **Everything else has no key.** `norn config` shows these values with the source `built-in` or `derived`.

### Keys that go away

| Key today | Becomes | Evidence |
|---|---|---|
| `default_agent`, `default_mode` | `agent`, `mode` | renamed. `agent` must be a built-in name or an entry in `agents`, checked after the merge |
| `agents.<name>.adapter` | optional | needed only for an X2 package; a built-in name is its own adapter (`codex: {}`) |
| `agents.<name>.env` | removed | passthrough only (`act.ts:556`); a wrapper `command` covers it |
| `runner: {adapter, options}` | `runner: herdr \| headless \| <package>` | unset means Herdr when `herdr` is on PATH, else `headless`. Herdr `bin` comes from PATH, `reuse_workspace` stays `true` (already the default), headless `log_dir` stays at its default, and the Herdr session comes from `HERDR_ENV` |
| `notifiers: [{adapter, options}]` | `notify: {os: true, ntfy: <url>, webhook: <url>}` | the Herdr notifier turns on by itself inside Herdr |
| `remote.provider` | top-level `provider` | detected from the remote URL (github → gh, gitlab → glab); set it only for a self-hosted host whose name says neither |
| `remote.label` | fixed `norn` | |
| `remote.host` | removed | never read |
| `remote.git_remote` | derived | the remote the base branch tracks, else `origin` |
| `remote.sync_interval` | fixed 5m | GR1 already says ~5 min; `norn sync` forces a sync |
| `default_workflow`, `default_slice_workflow` | the workflow files named `story` and `slice` | read only at `decide.ts:162,1327` and `view/load.ts:402,406`; W5 refuses when either file is missing |
| `max_checks` | follows `max_agents` | |
| `slots.min/max/port_base/ports_per_slot` | fixed: slots 1–9, ports from 4010, 10 per slot | |
| `slots.env` | removed | `.env.norn` already has `NORN_SLOT` and `PORT_BASE` (`store/src/leases.ts:192`); the app builds its own names from them |
| `watch_interval` | `watch --interval` / new `tick --interval` (default 30s) | recorded in `heartbeat.json`, so liveness checks (`inbox.ts:97,215`, `decide.ts:971`) agree with a cron tick |
| `claim.lease`, `claim.renew` | derived: lease = max(10m, 4 × interval), renew = lease / 3 | safe because each claim carries its own `expires_at` (`take.ts:158`, `decide.ts:254`) |
| `limits.deadline/nudges/retries` | step, then workflow `defaults:`, then 60m / 2 / 1 | steps already take them (`decide.ts:793,875,876`, `apply.ts:391,414`, `brief.ts:209-211`) |
| `limits.stalled` | step, then workflow `defaults:`, then 15m | the tick's hook read window (`observe.ts:325`) uses the longest `stalled` across the loaded workflows |
| `limits.attended_wait` | fixed 2m | |

`ResolvedConfig` keeps its shape and is filled by the new resolve step, so `@norn/core` does not change until the last steps.

### Also

- **Config errors** become `config_invalid` (and `config_wrong_file`), with a "Config error" title and their own exit code, never S2 `corrupt`.
- **`doctor`** reports an adapter that fails to build as a `FAIL config` line and runs the other checks.
- **`norn init`:**
  - adds `.agents/norn/config.local.yaml` to `IGNORED` (`packages/cli/src/commands/init.ts:20`);
  - writes a commented `~/.norn/config.yaml` when missing;
  - copies `config.schema.json` next to each file, with a `# yaml-language-server: $schema=` modeline.
- **A moved or removed key** is refused with `config_moved`, naming its replacement. A read-only `norn config --migrate` prints the rewritten files. There is no silent auto-migration (S1/S2).

## Behaviour changes to accept

- **The runner is detected.** The MO2 rule "no runner, so every story runs manual" goes away, and `mode` alone decides. The default stays `manual`.
- **The label is fixed at `norn`.**
- **`max_checks` no longer has its own value.** A repo whose checks share one database loses its separate knob.
- **Ports are fixed from 4010.** Anyone using `slots.env` has to derive names from `NORN_SLOT` in their app.

## Plan

Each step ships on its own and passes `bun test`, `bun run typecheck` and `schema:emit`:

1. **Config error code.** A `config_invalid` reason in `store/src/config.ts`, `ExitCode.config`, and the "Config error" title. Adapter errors name the source file. `doctor` turns a failed adapter build into a line instead of stopping.
2. **Agents merge per field.** `adapter` becomes optional for built-in names, and `agent` is checked after the merge. Update the AGENTS.md decision on auto permission mode.
3. **Typed notifiers and runner.** The `notify` map and the string `runner` with detection. Remove the option parsing from `notify/index.ts`, `herdr/index.ts`, `headless/index.ts`, `pane.ts`, `tidy.ts` and `doctor.ts`.
4. **Three files.** `UserConfig`, `LocalConfig` and `RepoConfig` schemas; `config_wrong_file` and `config_moved`; the local file is loaded and gitignored; `norn config` shows the five sources.
5. **Init starters and local schema copies.**
6. **Recorded interval and derived claim timing.** Remove `watch_interval` and `claim`.
7. **Workflow `defaults:`.** It takes the four limits and the default workflows by name. Remove `limits`, `default_workflow` and `default_slice_workflow`.
8. **Fix the rest.** Fixed slots, label, sync and git remote; remove `remote.host`, `agents.env` and `slots.env`; add `norn config --migrate`. Update the PRD, AGENTS.md, README, `docs/cookbook.html` and CHANGELOG (breaking config).

## PRD

- **K1–K4, K2a:** the files and their keys, caps, slots, and the sources `norn config` shows.
- **MO2:** the detected runner.
- **T3/T4:** derived claim timing.
- **ID2, B7, R5.1, R5.5:** the recorded interval.
- **GR1:** the fixed label and sync.
- **BS0:** the derived git remote.
- **W4, W5, W9:** workflow `defaults:` and the default workflows by name.
- **C1, §8 limits table:** where step limits come from.
- **HC2:** `attended_wait` fixed at 2m.
- **O3, HC14:** `notify`.
- **X2:** packages named by `adapter`, `runner` or a `notify` key.
- **S2:** config errors are not corrupt state.
