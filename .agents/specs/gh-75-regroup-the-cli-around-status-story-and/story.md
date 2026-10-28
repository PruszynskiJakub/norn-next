---
id: gh-75
slug: regroup-the-cli-around-status-story-and
provider: gh
number: 75
url: https://github.com/PruszynskiJakub/norn-next/issues/75
title: Regroup the CLI around status, story and run, modelled on gh
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:story
workflow: story
status: active
intake_at: 2026-10-28T08:50:06.913Z
body_hash: 59e0017417215f20d7c84bfcd35d4145fa644d1bcbad6f876e80e737d54021d0
---

## Observed

`norn help` lists 29 flat commands, and several do two or three jobs through flags:

- **Five overlapping views:** `status`, `inbox`, `cockpit`, `orient`, `trace`. Two of them overlap directly: `status <key>` and `orient` both show one story.
- **Flags that change what a command does:** `approve --reject`, `unstick --to`, `orient --open`, `cockpit --next`, `workflow --to`.
- **Names that mislead:**
  - `drop` sounds local and reversible, but it cancels the story (GR7).
  - `update` sounds like a self-update of norn; it actually re-enters the base-update step (BS9).
  - `release` collides with shipping a version.
  - `open` sounds like a view, but it starts a step.
- **`unstick` does three jobs:** resume, retry, and move to another step.
- **No way to:**
  - create a story (only a labelled issue plus `sync`);
  - stop a running agent (only `drop`, which cancels the story);
  - undo a drop;
  - set a config value.

## Wanted

A command surface modelled on gh. Nouns are things the person can see; verbs are shared across nouns and borrowed from gh where gh has the same action.

### Core

- `norn status`: what needs you, across every story. Replaces `inbox` and `cockpit`.
  - `--watch`: the live screen
  - `--history [--since]`
  - `--details`, `--notes`
- `norn story <verb> [<story|slice>]`, grouped as:
  - **general:** `create`, `list`, `view [--web]`
  - **decision:** `answer`, `approve`, `reject --reason`, `update-branch`
  - **work:** `start`, `chat`, `edit --auto|--manual|--workflow <name> [--at <step>]`
  - **team:** `checkout [--force]`, `handoff`, `close`, `reopen`
- `norn run <verb> [<run|unit>]`: `list`, `view [--why] [--receipt]`, `attach`, `rerun [--step] [--reset] [--reason]`, `cancel`
- **Setup:** `init`, `doctor [--live]`, `config list|get|set`, `uninstall`
- **Background:** `watch`, `sync`, `tidy`
- **Agent commands**, unchanged: `brief`, `done`, `ask`, `stuck`
- **Only in `help --all`:** `tick`, `hook`

### Habits taken from gh

- The target defaults to the unit of the current worktree.
- In a terminal, a missing argument prompts with only the units the verb applies to. Under `--json` or with no TTY, the command refuses instead (P8).
- Help is grouped into tiers.
- `--json` on every `list` and `view`.

### Map from today's commands

| Today | Proposed |
|---|---|
| `status` | `story list` |
| `status <key>`, `orient` | `story view` |
| `status --segment` | unchanged, hidden (Herdr tab bar) |
| `inbox [--details --notes --history]` | `status [same flags]` |
| `cockpit [--interval]`, `--json` | `status --watch`, `status --json` |
| `cockpit --open` | `status --watch --pane` (hidden, Herdr plugin) |
| `cockpit --next` | `run attach` |
| `orient --open` | `story chat` |
| `open [--print]` | `story start [--print]` |
| `answer` | `story answer` |
| `approve` / `approve --reject` | `story approve` / `story reject --reason` |
| `update` | `story update-branch` |
| `mode auto\|manual` | `story edit --auto\|--manual` |
| `workflow <unit> <name> [--to]` | `story edit --workflow <name> [--at]` |
| `take [--force]` | `story checkout [--force]` |
| `release` | `story handoff` |
| `drop` | `story close` |
| `trace [flags]` | `run list [flags]` |
| `why [flags]`, `why --receipt` | `run view --why [flags]`, `run view --receipt` |
| `unstick [--reset --reason]` | `run rerun [same]` |
| `unstick --to <step>` | `run rerun --step <step>` |
| `config [<key>]` | `config list` / `config get <key>` |
| none today | `story create`, `story reopen`, `run cancel`, `config set` |

### Stays as it is

- The agent protocol and `hook` (installed hook configs and skill copies keep working).
- Receipt kinds, `state.json`, trace events, exit codes, and the `CliError` shape.
- The `--json` shapes of moved commands.

### Migration

- Old names stay as hidden aliases for one minor release.
- The alias hint goes to stderr only, so `--json` stdout is untouched.
- `status --segment` stays for good.

### Order of work, as slices

1. Amend the PRD: rewrite §15 as the noun tree, and write rules for the new behaviour.
2. Subcommands, help tiers and aliases.
3. Move the `story` and `run` verbs, and rewrite every command string norn prints in the same change.
4. `status` absorbs `inbox` and `cockpit`.
5. New behaviour, one slice each: `run cancel`, `story reopen`, `story create`, `config set`, context defaults and prompts.

Removing the aliases is a later release.

### Decisions for refine (recommendation first)

- **`status` changes meaning** (today it lists stories). Recommended: take the name, like gh, with a one-time notice. Alternative: keep `inbox` as the overview.
- **Moving to another step.** Recommended: `run rerun --step`. Alternative: `story edit --at`.
- **Aliases.** Recommended: one minor release. Alternative: keep them for good.
- **User-defined aliases (like `gh alias set`).** Recommended: not now.

### Related

- #74 renames the core noun "story". Settle the noun before or together with this; the tree's middle noun depends on it.
- #64 (minimal config) affects `config set`.

## Where

- Command layer: `packages/cli/src/cli.ts`, `packages/cli/src/commands/index.ts`, `packages/cli/src/commands/help.ts`, `packages/cli/src/commands/*.ts`
- Command strings norn prints:
  - `packages/core/src/commands.ts`
  - `packages/core/src/inbox/items.ts`
  - `packages/core/src/decide/steps.ts`
  - `packages/view/src/orient.ts`
  - `packages/view/src/cockpit.ts` (ACTIONS)
  - `packages/cli/src/runtime/human.ts`
  - the `do_instead` of every command
- Pinned outputs: observe snapshots, effect transcripts, and the golden corpus if decide's output names commands
- Docs and plugins: Herdr plugin (`next.sh`, `pick.sh`, `cockpit.sh`, `open.sh`), README, CONTRIBUTING, the `triage` skill, AGENTS.md (P8 markdown list, `status --segment` and orient-shim decisions, Process's `norn workflow … --to`)

## PRD

§15 command table; O1, O2, O5; MO1, MO5; T5–T9; BS9–BS10; W4, W9; S7; GR1, GR7; K2a, K5, K7; HC4–HC13; P8.
