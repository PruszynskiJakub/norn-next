<p align="center">
  <img src="docs/assets/norn.svg" alt="norn" width="96" height="96">
</p>

<h1 align="center">norn</h1>

<p align="center">
  <strong>Deliver software stories with coding agents, with every decision in deterministic code.</strong>
</p>

<p align="center">
  <a href="https://github.com/PruszynskiJakub/norn-next/actions/workflows/ci.yml"><img src="https://github.com/PruszynskiJakub/norn-next/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/PruszynskiJakub/norn-next/releases"><img src="https://img.shields.io/badge/release-v0.2.0-blue" alt="Release v0.2.0"></a>
  <img src="https://img.shields.io/badge/bun-%3E%3D1.3-f9f1e1" alt="Bun 1.3 or later">
</p>

> [!NOTE]
> norn is pre-1.0: a minor version can change the machine contract (JSON output, persisted formats), and [`CHANGELOG.md`](CHANGELOG.md) says what changed. It is tested on Claude Code; the other agents should work but are less exercised.

norn is a CLI that delivers software stories with coding agents (Claude Code, Codex, OpenCode, Gemini, …) and keeps every decision in deterministic code. It works with any of these agents. A stateless heartbeat, `norn tick`, reads the markdown specs, the JSON run state, git and the runner. A pure function then picks the next action, and norn tells an agent to do one bounded step. Workflows are JSON/YAML data. State lives in the repository and in git refs, so a team on GitHub or GitLab can hand a story over at any commit.

**What it fixes.** Agent state is invisible: an agent asks a question, dies or ends its turn, and nothing notices. Unattended LLM loops drift and repeat steps. A stuck story has no handoff. Nobody can tell what waits for a human. norn's answers:

- **Code decides, agents do.** The tick owns every transition. An agent does one step and reports an outcome (`norn done`, `norn ask` or `norn stuck`), and never names the next step.
- **Pull, don't trust.** Each tick observes the runner, git and the files again. Notifications are never treated as truth, and a restarted heartbeat behaves the same.
- **Bounded everything.** Every retry, nudge and loop has a counter with a max. Going past it is a visible `stuck`.
- **Receipts before effects.** Every externally visible action writes an immutable receipt first, so a repeated tick never repeats the action. Every action can be traced (`norn trace`) and explained (`norn why`).
- **JSON + exit codes.** Every command prints one JSON value on stdout (`norn brief` prints markdown for the agent; `--json` for data). Refusals print `{error, do_instead}` and exit with code 3.

The full spec is in [`.agents/PRD.md`](.agents/PRD.md).

## Install

Releases are listed in [`CHANGELOG.md`](CHANGELOG.md) and on the [releases page](https://github.com/PruszynskiJakub/norn-next/releases).

**From GitHub Packages** (npm). The package is a Bun bundle, so it needs [Bun](https://bun.sh) ≥ 1.3 on `PATH`. GitHub's npm registry always asks for a token, even to install: create a personal access token (classic) with the `read:packages` scope, then:

```sh
echo "@pruszynskijakub:registry=https://npm.pkg.github.com" >> ~/.npmrc
echo "//npm.pkg.github.com/:_authToken=<your token>" >> ~/.npmrc
bun add -g @pruszynskijakub/norn      # or: npm install -g @pruszynskijakub/norn
norn --version
```

**As a single-file binary** (no Bun needed). Each release carries `norn-darwin-arm64`, `norn-darwin-x64`, `norn-linux-x64`, `norn-linux-arm64` and `SHA256SUMS`:

```sh
gh release download --repo PruszynskiJakub/norn-next --pattern 'norn-darwin-arm64'
install -m 755 norn-darwin-arm64 /usr/local/bin/norn
```

On first run the binary unpacks its bundled skills and workflow templates into `${XDG_CACHE_HOME:-~/.cache}/norn/`.

norn also needs `git` and the remote CLI you use, `gh` or `glab`, signed in.

### Claude Code plugin

`plugins/claude-code` contains a `/norn` command, which loads the norn skill and runs `norn brief`. The plugin has no logic and no skills of its own: the skills come from your repo (`norn init`), and the `norn` CLI must still be on `PATH`.

```sh
claude plugin marketplace add ./plugins     # from a checkout of this repo
claude plugin install norn@norn
```

You don't need the plugin to use norn with Claude Code: `norn init` puts the skills where Claude finds them.

### Skills

`norn init` copies norn's skills, whole folders with their reference files, into `.agents/skills/` (`norn`, `norn-refine`, `norn-plan`, `norn-implement`, `norn-review`, `norn-qa`, …) and links them from each configured agent's skill folder: `.claude/skills/`, `.gemini/skills/`, `.opencode/skills/` (Codex reads `.agents/skills/` itself). Commit them. Each `norn init` replaces them with the bundled version and lists what it updated; `git diff .agents/skills/` shows the change. To change how a step is done, write your own skill under another name and name it in the step (`skill: my-review`). `norn doctor` reports skills that are missing, not linked or out of date. Links need a filesystem that supports them (on Windows, developer mode).

## Quickstart

```sh
cd your-repo
norn init          # .agents/norn/config.yaml, workflows/{story,slice,bug}.yaml, .agents/skills (linked per agent), hooks, .gitignore, .gitattributes
# edit .agents/norn/config.yaml: remote.provider (gh | glab), remote.label (default: norn)
norn sync          # issues assigned to you with the label become stories
norn tick          # one heartbeat: observe, decide, act
norn watch         # keep ticking (Ctrl-C finishes the current tick and releases claims)
norn inbox         # what needs you: Your turn, Answer, Approve, Unblock, Unclaimed, Running
```

Every inbox item shows the exact command that resolves it, for example `norn answer …`, `norn approve …` or `norn unstick …`.

**What gets committed.** A story's run state lives in `.agents/specs/<id>-<slug>/runs/`: `state.json`, numbered receipts, the pinned workflow, logs of failed checks, QA evidence and `handoff.md`. norn commits it with the agent's work at each step boundary and pushes the branch, so anyone can take the story over from any commit. `norn init` marks `runs/` as generated in `.gitattributes`, so GitHub and GitLab collapse it in the PR diff and the review shows the code. Per-tick detail stays in `.agents/norn/trace/`, which is gitignored.

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
plugins/claude-code                Claude Code plugin (the /norn command only)
scripts/                           build and plugin sync
```

Contributor rules and the dependency direction are in [`AGENTS.md`](AGENTS.md). In a repo where norn is set up, the files norn writes are described in PRD §7.

## Development

```sh
bun install
bun test               # all tests, including the check that the plugin is in sync
bun run typecheck
bun run schema:emit    # after changing a schema
bun run sync:plugin    # after changing the @norn/cli version
bun run build          # dist/npm/: bundled norn.js + assets/ + package.json, ready to pack
bun run build:bin      # dist/bin/norn-{darwin-arm64,darwin-x64,linux-x64,linux-arm64}
```

`bun run build:bin linux-x64` builds only the targets you name. To run from source, use `bun packages/cli/src/main.ts <command>`. Set `NORN_ASSETS_DIR` to use a different assets folder (skills, workflow templates, config template); otherwise norn uses the assets embedded in the binary, then `assets/` next to `norn.js`, then `packages/cli/assets`.

## Credits

The `norn-codebase-design` and `norn-tdd` skills and the approach of the step skills are adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT), by way of norn v0.11.0.
