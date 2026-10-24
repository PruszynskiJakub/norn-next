<p align="center">
  <img src="docs/assets/norn.svg" alt="norn" width="96" height="96">
</p>

<h1 align="center">norn</h1>

norn is a CLI that delivers software stories with coding agents (Claude Code, Codex, OpenCode, Gemini, …) and keeps every decision in deterministic code. It works with any of these agents. A stateless heartbeat, `norn tick`, reads the markdown specs, the JSON run state, git and the runner. A pure function then picks the next action, and norn tells an agent to do one bounded step. Workflows are JSON/YAML data. State lives in the repository and in git refs, so a team on GitHub or GitLab can hand a story over at any commit.

**What it fixes.** Agent state is invisible: an agent asks a question, dies or ends its turn, and nothing notices. Unattended LLM loops drift and repeat steps. A stuck story has no handoff. Nobody can tell what waits for a human. norn's answers:

- **Code decides, agents do.** The tick owns every transition. An agent does one step and reports an outcome (`norn done`, `norn ask` or `norn stuck`), and never names the next step.
- **Pull, don't trust.** Each tick observes the runner, git and the files again. Notifications are never treated as truth, and a restarted heartbeat behaves the same.
- **Bounded everything.** Every retry, nudge and loop has a counter with a max. Going past it is a visible `stuck`.
- **Receipts before effects.** Every externally visible action writes an immutable receipt first, so a repeated tick never repeats the action. Every action can be traced (`norn trace`) and explained (`norn why`).
- **JSON + exit codes.** Every command prints one JSON value on stdout. Refusals print `{error, do_instead}` and exit with code 3.

The full spec is in [`.agents/PRD.md`](.agents/PRD.md).

## Install

Via npm (the package is a Bun bundle, so it needs [Bun](https://bun.sh) ≥ 1.3 on `PATH`):

```sh
bun add -g @norn/cli      # or: npm install -g @norn/cli
```

As a single-file binary (no Bun needed). Pick `norn-darwin-arm64`, `norn-darwin-x64`, `norn-linux-x64` or `norn-linux-arm64`:

```sh
install -m 755 norn-darwin-arm64 /usr/local/bin/norn
```

On first run the binary unpacks its bundled skills and workflow templates into `${XDG_CACHE_HOME:-~/.cache}/norn/`.

norn also needs `git` and the remote CLI you use, `gh` or `glab`, signed in.

### Claude Code plugin

`plugins/claude-code` contains the ten norn skills and a `/norn` command, which loads the norn skill and runs `norn brief`. The plugin has no logic of its own, so the `norn` CLI must still be on `PATH`.

```sh
claude plugin marketplace add ./plugins     # from a checkout of this repo
claude plugin install norn@norn
```

`norn init` also installs the skills into `.claude/skills`, so you don't need the plugin to use norn with Claude Code.

## Quickstart

```sh
cd your-repo
norn init          # .agents/norn/config.yaml, workflows/{story,slice,bug}.yaml, agent skills and hooks
# edit .agents/norn/config.yaml: remote.provider (gh | glab), remote.label (default: norn)
norn sync          # issues assigned to you with the label become stories
norn tick          # one heartbeat: observe, decide, act
norn watch         # keep ticking (Ctrl-C finishes the current tick and releases claims)
norn inbox         # what needs you: Your turn, Answer, Approve, Unblock, Unclaimed, Running
```

Every inbox item shows the exact command that resolves it, for example `norn answer …`, `norn approve …` or `norn unstick …`.

**Manual and auto mode.** Each story has a mode. The repo default is `default_mode` in the config, and `norn mode <story> auto|manual` switches it.

- **manual** (the default): the tick marks unattended agent steps as ready. You open any agent in the unit's worktree and tell it: *"Use the norn skill, then run `norn brief`"* (or type `/norn` with the Claude Code plugin).
- **auto**: the tick starts agents itself through the configured `runner` (`herdr` or `headless`). If a machine has no runner configured, its stories run in manual mode.

In both modes, `check` and `git` steps run on their own. Attended steps (`attended: true`) and `gate` steps always wait for a person.

## Commands

| Area | Commands |
|---|---|
| Setup | `init`, `uninstall`, `doctor` |
| Remote | `sync` |
| Heartbeat | `tick`, `watch` |
| Agent protocol | `brief`, `done`, `ask`, `stuck`, `hook` |
| Human | `inbox`, `answer`, `approve [--reject]`, `unstick [--to <step>] [--reset <counter>]`, `mode`, `workflow` |
| Team | `take`, `release`, `drop` |
| Views | `status`, `trace <unit>`, `why <unit>` |
| Housekeeping | `tidy` |

This table is the v1 plan (PRD §15). Run `norn help` to see what your build has, or `norn help <command>` for one command's usage.

## Repository layout

```
packages/schema    @norn/schema    JSON Schemas, types, validators, ids, config merge
packages/core      @norn/core      pure logic: adapter ports, facts, decide, briefing (no IO)
packages/store     @norn/store     .agents/ files, runs/ JSON, claim and mailbox refs, leases
packages/adapters  @norn/adapters  git, gh, glab, herdr, headless, claude, codex, opencode, gemini, notify
packages/view      @norn/view      read model loadProjectView()
packages/cli       @norn/cli       wiring and commands; assets/ holds skills, workflows, config template
plugins/claude-code                Claude Code plugin (skills copied from packages/cli/assets/skills)
scripts/                           build and plugin sync
```

Contributor rules and the dependency direction are in [`AGENTS.md`](AGENTS.md). In a repo where norn is set up, the files norn writes are described in PRD §7.

## Development

```sh
bun install
bun test               # all tests, including the check that the plugin skills are in sync
bun run typecheck
bun run schema:emit    # after changing a schema
bun run sync:plugin    # after changing packages/cli/assets/skills
bun run build          # dist/npm/: bundled norn.js + assets/ + package.json, ready to pack
bun run build:bin      # dist/bin/norn-{darwin-arm64,darwin-x64,linux-x64,linux-arm64}
```

`bun run build:bin linux-x64` builds only the targets you name. To run from source, use `bun packages/cli/src/main.ts <command>`. Set `NORN_ASSETS_DIR` to use a different assets folder (skills, workflow templates, config template); otherwise norn uses the assets embedded in the binary, then `assets/` next to `norn.js`, then `packages/cli/assets`.
