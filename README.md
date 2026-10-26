<p align="center">
  <img src="docs/assets/norn.svg" alt="norn" width="96" height="96">
</p>

<h1 align="center">norn</h1>

<p align="center">
  <strong>Hand software stories to coding agents, and always know what is waiting for you.</strong>
</p>

<p align="center">
  <a href="https://github.com/PruszynskiJakub/norn-next/actions/workflows/ci.yml"><img src="https://github.com/PruszynskiJakub/norn-next/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/PruszynskiJakub/norn-next/releases"><img src="https://img.shields.io/badge/release-v0.7.1-blue" alt="Release v0.7.1"></a>
  <img src="https://img.shields.io/badge/bun-%3E%3D1.3-f9f1e1" alt="Bun 1.3 or later">
</p>

> [!NOTE]
> norn is pre-1.0: a minor version can change the machine contract (JSON output, persisted formats), and [`CHANGELOG.md`](CHANGELOG.md) says what changed. It is tested on Claude Code; Codex, OpenCode and Gemini should work but are less exercised.

You give a story to a coding agent and switch to something else. Forty minutes later you look back: the agent has been waiting on a question in a pane you closed. Or it died halfway through. Or it ran the same failing test three times, said it was done, and nothing checked.

**norn delivers stories with coding agents one bounded step at a time and keeps one inbox of everything that needs you.** You label a GitHub or GitLab issue. norn takes it in, gives it a branch and a worktree, and walks it through a workflow: refine the spec with you, plan, implement in slices, test, review, QA, open a draft PR. Agents do the steps. Plain code decides what comes next, notices when an agent asks, dies or stalls, and tells you exactly which command answers it.

```console
$ norn inbox
Your turn (1)
  gh-21      refine: attended step — work with the agent · 2m
      $ norn open gh-21

Answer (1)
  gh-18/02   implement: Keep the old /export endpoint for API clients, or remove it? · 6m
      $ norn answer gh-18/02 "…"

Approve (1)
  gh-17      approve-plan: Review the Plan section in story.md and the slice files (edit them if needed). Approve to start the slices, or reject with what to change. · 25m
      $ norn approve gh-17

Running (1)
  gh-18/01   review #1 (auto) · 3m
      $ norn trace gh-18/01
```

## Why not just run Claude Code, or a loop around it?

An agent on its own is good at one step. Delivering a story is many steps, and the parts between them are where work gets lost:

| When… | With an agent alone | With norn |
|---|---|---|
| the agent asks a question | it waits in its pane until you happen to look | the question is an inbox item with the command that answers it, and a desktop notification fires |
| a permission prompt blocks it | same, but quieter | it shows up as a question; `norn answer` types the key the prompt expects |
| the agent dies or hangs mid-step | nobody notices | it is classified `died` or `stalled` and retried or nudged; a killed agent was retried within 9 s in the dogfood runs |
| it loops, drifts or repeats a step | an LLM decides when to stop | code picks every next step; each retry and loop has a counter with a max, and going past it is a visible `stuck` |
| `main` moves under the story | you merge by hand | an `update` step merges the base in; predicted conflicts go to a `resolve` step |
| you wonder why something happened | scroll back through a transcript | `norn trace` shows the step timeline; `norn why` replays the decision and names the rule |
| a colleague takes over | they start from scratch | state lives in the repo and in git refs; `norn take` continues from any commit |

The evidence is in the dogfood audits: [`docs/audit-todoist-dogfood/`](docs/audit-todoist-dogfood/), [`docs/audit-auto-mode/`](docs/audit-auto-mode/) and [`docs/audit-base-sync-qa/`](docs/audit-base-sync-qa/).

## Is norn for you?

**A good fit today:** one person, Claude Code, GitHub, a test suite you trust, and stories big enough to plan. Several stories can run in parallel on one machine, attended by you (manual mode) or started by norn (auto mode).

**Not yet, or not at all:**
- Quick interactive edits. norn works per story on a heartbeat, so the overhead is not worth it for a one-line fix.
- Repos without GitHub or GitLab issues and PRs. Stories come from labelled issues, and there is no local-only mode.
- GitLab, or an agent other than Claude Code. The `glab`, codex, opencode and gemini adapters exist but are tested only against recorded fixtures, never live.
- Teams that require linear history on every branch. norn merges the base into story branches and never rebases; squash on merge keeps the base linear.
- Two machines on one story. It is designed for that, but it has only been simulated on one Mac so far.
- Relying on the herdr cockpit or the default `--permission-mode auto`. Both are tested against fixtures only; no real run has used them yet.

Read [`.agents/LIMITATIONS.md`](.agents/LIMITATIONS.md) before you rely on it: it lists what is proven, what is open and what was never run for real.

## Get started

You need git ≥ 2.38, an agent CLI (Claude Code is the tested one), and `gh` or `glab` signed in.

### 1. Install

**Single-file binary** (the quickest: no Bun, no token, no sign-in). Each release carries `norn-darwin-arm64`, `norn-darwin-x64`, `norn-linux-x64`, `norn-linux-arm64` and `SHA256SUMS`:

```sh
curl -fsSLO https://github.com/PruszynskiJakub/norn-next/releases/latest/download/norn-darwin-arm64
install -m 755 norn-darwin-arm64 /usr/local/bin/norn
norn --version
```

On first run the binary unpacks its bundled skills and workflow templates into `${XDG_CACHE_HOME:-~/.cache}/norn/`.

**From GitHub Packages** (npm). The package is a Bun bundle, so it needs [Bun](https://bun.sh) ≥ 1.3 on `PATH`. GitHub's npm registry always asks for a token, even to install: create a personal access token (classic) with the `read:packages` scope, then:

```sh
echo "@pruszynskijakub:registry=https://npm.pkg.github.com" >> ~/.npmrc
echo "//npm.pkg.github.com/:_authToken=<your token>" >> ~/.npmrc
bun add -g @pruszynskijakub/norn      # or: npm install -g @pruszynskijakub/norn
```

Releases are listed in [`CHANGELOG.md`](CHANGELOG.md) and on the [releases page](https://github.com/PruszynskiJakub/norn-next/releases).

### 2. Set up your repository

```sh
cd your-repo
norn init
```

`norn init` writes the config (`.agents/norn/config.yaml`), three workflows (`story`, `slice`, `bug`), the agent skills and hooks, and its `.gitignore` and `.gitattributes` lines. It reads your test command from your build files, then prints the next steps, which are:

1. Check the test command it wrote into the workflows' `test` steps.
2. Commit and push the setup.
3. Run `norn doctor` to check this machine: agents, hooks, remote auth, runner and skills.

GitLab users set `remote.provider: glab` in the config. The label that marks a story is `remote.label` (default `norn`).

### 3. Run your first story

```sh
gh label create norn                                          # once
gh issue create --label norn --assignee @me --title "Add CSV export of orders"
norn sync      # the issue becomes story gh-N: a branch, a worktree, a spec folder
norn watch     # keeps norn working; Ctrl-C finishes the current tick and releases claims
norn inbox     # in another terminal: what needs you, with the command for each item
```

The default `story` workflow starts with **refine**, an attended step. Run the command in the inbox (`norn open gh-N` with Herdr, otherwise a `cd … && claude …` line), then work out the spec with the agent. When you agree, the agent reports and norn moves on to plan, slices, test, QA and the draft PR. You come back when the inbox says so. Your last act is merging the PR. Squash it if you want a linear base: the story branch carries merge commits from `update`, since norn never rebases.

## Everyday use

Five commands cover most days:

| Command | What it does |
|---|---|
| `norn watch` | keeps norn working: observe, decide, act, every 30 s; prints a JSON line per tick, `--human` a line per action |
| `norn inbox` | what needs you, grouped as Your turn, Answer, Approve, Unblock, Unclaimed, Running |
| `norn open <story>` | starts an agent on a step that waits for you |
| `norn answer` / `norn approve` / `norn unstick` | resolves an item; the inbox prints the exact line |
| `norn status` | every story, slice, run and claim at a glance |

`norn help` lists every command, grouped, with the ones to start with first. `norn help <command>` shows one command's usage.

For recipes by situation (a first story, an agent that asks or dies, a moved `main`, custom workflows, handing a story over), open [`docs/cookbook.html`](docs/cookbook.html) in a browser.

**Manual and auto mode.** Each story has a mode. The repo default is `default_mode` in the config, and `norn mode <story> auto|manual` switches it.

- **manual** (the default): when an agent step is ready, the inbox shows how to start it. With the `herdr` runner, `norn open <unit>` opens a tab in the unit's worktree with the agent started on the brief. Otherwise, open any agent in the unit's worktree and tell it *"Use the norn skill, then run `norn brief`"* (or type `/norn` with the Claude Code plugin).
- **auto**: norn starts agents itself through the configured `runner` (`herdr` or `headless`). A machine with no runner runs its stories in manual mode.

In both modes, `check` and `git` steps run on their own. Attended steps (`attended: true`, such as refine and plan) and `gate` steps always wait for a person, even in auto mode. When the agent of an attended step has waited for you longer than `limits.attended_wait` (default 2 minutes), the inbox moves it from Running to Your turn.

**What gets committed.** A story's run state lives in `.agents/specs/<id>-<slug>/runs/`: `state.json`, numbered receipts, the pinned workflow, logs of failed checks, QA evidence and `handoff.md`. norn commits it with the agent's work at each step boundary and pushes the branch, so anyone can take the story over from any commit. `runs/` is marked as generated, so GitHub and GitLab collapse it in the PR diff. Per-tick detail stays in `.agents/norn/trace/`, which is gitignored.

## Concepts in a minute

| Term | Meaning |
|---|---|
| **story** | a labelled issue assigned to you: one spec folder, one branch, one worktree, one draft PR |
| **slice** | a piece of a story with its own branch and worktree, merged back into the story |
| **unit** | a story or a slice: what commands like `answer`, `trace` and `why` take, written `gh-18` (a story) or `gh-18/02` (its second slice) |
| **workflow** | the steps a story or slice goes through, as YAML in `.agents/norn/workflows/` |
| **step** | one node of a workflow: an `agent` step, a `check` (a command), a `git` action, or a `gate` (a person approves) |
| **outcome** | how an agent says a step ended: `norn done <outcome>`, `norn ask` or `norn stuck`; the workflow maps each outcome to the next step |
| **tick** | one pass of the heartbeat: observe the agents, git and the remote, decide, act; `norn watch` runs ticks in a loop |
| **inbox** | everything that needs a person, with the command that resolves each item |

The full glossary is in [PRD §5](.agents/PRD.md#5-glossary).

## Make it yours

**Workflows are data.** Edit the YAML in `.agents/norn/workflows/` or add your own; `norn workflow <unit> <name>` picks one for a unit. A step names its skill and its outcomes:

```yaml
  test:
    type: check
    run: npm ci && npm test
    timeout: 15m
    outcomes: { pass: qa, fail: { to: implement, counter: test_loop } }
```

A unit pins its workflow when it starts, so editing a file does not affect stories already in flight.

**Skills carry the craft.** `norn init` copies norn's skills (`norn`, `norn-refine`, `norn-plan`, `norn-implement`, `norn-review`, `norn-qa`, …) as whole folders into `.agents/skills/` and links them from each configured agent's skill folder: `.claude/skills/`, `.gemini/skills/`, `.opencode/skills/` (Codex reads `.agents/skills/` itself). Commit them. Each `norn init` replaces them with the bundled version and lists what it updated; `git diff .agents/skills/` shows the change. To change how a step is done, write your own skill under another name and name it in the step (`skill: my-review`). `norn doctor` reports skills that are missing, not linked or out of date. Links need a filesystem that supports them (on Windows, developer mode).

**Config** lives in two files with the same keys: `.agents/norn/config.yaml` (committed, what the team agrees on: remote, workflows, limits) and `~/.norn/config.yaml` (yours: runner, machine caps, notifiers, default mode). The repo file wins, except that it can only lower machine caps. The template `norn init` writes groups the keys by who they belong to, with their defaults. `norn config` shows every setting in effect, the file it came from and what it does.

## Plugins

### Claude Code

`plugins/claude-code` adds a `/norn` command, which loads the norn skill and runs `norn brief`. The plugin has no logic and no skills of its own: the skills come from your repo (`norn init`), and the `norn` CLI must still be on `PATH`. You don't need it: `norn init` already puts the skills where Claude finds them.

```sh
claude plugin marketplace add ./plugins     # from a checkout of this repo
claude plugin install norn@norn
```

### Herdr

`plugins/herdr` adds the norn cockpit to Herdr: a pane running `norn pane --interactive`, which numbers the inbox items and takes one command per line (`3` goes to item 3's agent, `w 3` to its Herdr workspace, `a 2 Postgres` answers, `y 1` approves, `t 4` takes, `?` lists the rest). Every change goes through the same `norn` commands you would type. While it runs, it labels the agent pane of each norn run in Herdr's sidebar (`gh-12 · refine`, `norn: your turn`).

```sh
herdr plugin install PruszynskiJakub/norn-next/plugins/herdr   # update it with herdr plugin update
```

Working on norn itself? Link your checkout instead, so the plugin follows `git pull`: `herdr plugin link <checkout>/plugins/herdr`. `norn doctor` suggests whichever fits.

The plugin has two actions you can bind to keys in Herdr's `config.toml`: `norn.open` opens the cockpit below the focused pane, and `norn.next` jumps to the agent that waits for you. To get inbox notifications as Herdr toasts, add `{adapter: herdr}` to `notifiers` in the config.

## How it works

- **Code decides, agents do.** The tick owns every transition. An agent does one step and reports an outcome (`norn done`, `norn ask` or `norn stuck`), and never names the next step.
- **Pull, don't trust.** Each tick observes the runner, git and the files again. Notifications are never treated as truth, and a restarted heartbeat behaves the same.
- **Bounded everything.** Every retry, nudge and loop has a counter with a max. Going past it is a visible `stuck`.
- **Receipts before effects.** Every externally visible action writes an immutable receipt first, so a repeated tick never repeats the action. Every action can be traced (`norn trace`) and explained (`norn why`).
- **Markdown to read, JSON for code, exit codes for both.** Commands an agent or a person reads print markdown: `brief`, `done`, `ask`, `stuck`, `help`, `init`, `doctor`, `config`, `status`, `inbox`, `trace`. Every command prints one JSON value with `--json`, and the rest always do. Refusals exit with code 3 and print `{error, do_instead}` (as markdown without `--json`).

The full spec is in [`.agents/PRD.md`](.agents/PRD.md); the files norn writes in a repo are described in PRD §7.

### All commands

| Area | Commands |
|---|---|
| Setup | `init`, `uninstall`, `doctor` |
| Remote | `sync` |
| Heartbeat | `tick`, `watch` |
| Agent protocol | `brief`, `done`, `ask`, `stuck`, `hook` |
| Human | `inbox`, `open`, `answer`, `approve [--reject]`, `unstick [--to <step>] [--reset <counter>]`, `update`, `mode`, `workflow` |
| Team | `take`, `release`, `drop` |
| Views | `status`, `config [<key>]`, `trace <unit>`, `why <unit>`, `pane [--interactive \| --next \| --open]` |
| Housekeeping | `tidy` |

## Contributing

Contributor rules and the dependency direction are in [`AGENTS.md`](AGENTS.md).

```
packages/schema    @norn/schema    JSON Schemas, types, validators, ids, config merge
packages/core      @norn/core      pure logic: adapter ports, facts, decide, briefing (no IO)
packages/store     @norn/store     .agents/ files, runs/ JSON, claim and mailbox refs, leases
packages/adapters  @norn/adapters  git, gh, glab, herdr, headless, claude, codex, opencode, gemini, notify
packages/view      @norn/view      read model loadProjectView()
packages/cli       @norn/cli       wiring and commands; assets/ holds skills, workflows, config template
plugins/                           Claude Code plugin (the /norn command) and Herdr plugin (the cockpit)
scripts/                           build, plugin sync, smoke test
```

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
