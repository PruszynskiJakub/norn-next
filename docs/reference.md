# Reference

Every command and flag, every config key, the signals a workflow can route, the inputs an agent step can name, the workflows the bundled pack ships and the exit codes. The lists between the two marker comments below are generated from the CLI itself (`bun run docs:emit`), so they match the release this file ships with. What the terms mean is in [Concepts](concepts.md).

## Output and exit codes

Commands a person or an agent reads print markdown. Every command prints one JSON value instead with `--json`; `norn hook` answers its harness in the harness's own format. Code should branch on the exit code and the `--json` data, never on the markdown.

A refusal prints `{error, do_instead, code}` (as markdown without `--json`): what was refused, what to do instead and a stable code. The exit code says why: `refused` (3) when a rule says no, `usage` (2) for bad arguments, `corrupt` (4) when a file norn keeps fails validation, `busy` (5) when another process holds the lock or the claim, `config` (6) when a config file is wrong. The full list is under [Exit codes](#exit-codes).

## Config

`norn init` writes the config from what it detects (the tracker, the forge, the executor and the runner; a flag overrides each choice) and runs `norn doctor`. Three files hold it, and every file takes every key:

| File | For |
|---|---|
| `<norn home>/config.yaml` | this machine, and your defaults for every repository (`~/.norn`, or `NORN_HOME_DIR`) |
| `.agents/norn.local.yaml` | you, in this repository: kept out of git, the file `norn init` writes |
| `.agents/norn.yaml` | the team: committed, written by `norn init --commit` |

The nearer file wins: the committed file over the local file over the user file over the built-in defaults. Maps merge key by key; lists and scalars replace. A key norn does not know is refused with the file it is in, never ignored; a slot (`tracker`, `forge`, `store`, `vcs`, an executor's `runner`) also takes the keys of the plugin it names, and that plugin checks them. `norn config show` prints the merged config and the file each key came from; `norn config set <key> <value>` changes one key in the local file, or in the committed file with `--commit` or the user file with `--user`.

A slot names a plugin with `use`: the bundled ones are listed by `norn plugin list`, and `norn plugin add <spec>` installs another and pins it in the plugin lock. An executor pairs a harness (the agent: `claude`, `pi`) with a runner (where it runs: `headless`, `herdr`); an agent step runs on `executor`, or on the only executor when there is one.

## Signals

A gate or a wait step kind (`await-merge`) routes signals under `on:`, beside its `outcomes:`. Each entry takes the route shape of `outcomes:` (a step name, `$done`, `$stuck`, or `{to | exit, max, counter}`), plus the signal's own parameters. The edge is `<step>.<signal>`, so `counter:`, `reset_on` and `norn run rerun --reset` name it as they name an outcome's. A route back is bounded by `kernel.counters.stale` (10) unless it sets `max:`.

| Signal | Source | Parameters | Fires when | Occurrence id |
|---|---|---|---|---|
| `stale` | vcs | none | the base moved under the story the way the workflow's `base.stale` names: `behind` (the base has a commit the story lacks) or `conflict` (the default: merging the base conflicts, or with `base.verify` breaks the merged tree) | the base commit |
| `unpushed` | vcs | none | the story branch moved past its open change's head with commits beyond the story's spec folder | the story head |
| `timeout` | clock | `after:` a duration (`30m`, `48h`, `7d`), required | the step has waited `after:`: a gate since it parked, a wait step since its run started | the step visit (`ready#3`) |

A plugin declares more under `provides.signals`; `norn plugin list` names them, and a workflow that routes one loads only with that plugin configured. A signal fires once per occurrence id in a round, the first listed first, one per tick, and only for the story's own unit. `on:` on an agent, check, effect step or slices step is refused, and so is an undeclared signal or a name under both `outcomes:` and `on:`. A wait step kind that answers a signal's name as its own outcome (`await-merge` answers `unpushed`) takes the one route under `on:` for both. A waiting step written before `on:`, with `stale` or `unpushed` under `outcomes:`, still loads to the same graph; `norn doctor` warns about a repo file in that form.

## Inputs

An agent step's `inputs:` lists what its brief gives it. norn writes each one under `.agents/` in the unit's worktree, and the brief names its path; an input norn holds nothing for yet is listed with a note.

| Input | What the agent gets |
|---|---|
| `spec` | the story's spec, `.agents/specs/<story>/spec.md`: its tracker item, mirrored, and the sections later steps added |
| `handoff` | this unit's handoff, `.agents/specs/<story>/handoffs/<unit>.md`, which the agent keeps current |
| `last_check` | the last check's exit, outcome and the end of its output |
| `last_findings` | the findings that sent the work back: a rejected gate's reason, or the report of the step that handed findings back |
| `signal` | the signal that moved the story from where it waited, with what its source reported; the agent step right after a signal gets it whether or not it lists it |
| `diff` | the `git diff` command that shows the change so far |
| `slice` | this slice's file, `slices/<nn>-<slug>.md` in the story's spec folder |
| `slices` | every slice file of the story, with where each slice stands |
| `record` | the story's record: every unit's outcomes, gate rulings and criteria reports with their evidence |
| `resolution` | the resolution to review: each merge's remerge-diff and the conflicts this round recorded |
| `base_side` | the base side of a conflict: the base commit to merge and what it changed in each conflicting path |

An entry may also be a file in the repo, `{file: <path>, label: <text>}`, which the brief names as it is. A workflow file naming any other input is refused when it loads, at the step and the entry (`/steps/review/inputs/2`), with the names above. A unit that pinned a workflow naming one before norn refused such names keeps running it, and its brief notes that norn provides no input of that name.

## Generated reference

<!-- norn:reference:start — generated by `bun run docs:emit`; edit the cli, not this block -->

### Commands

Every command also takes `--json` (one JSON value instead of markdown) and `--help`.

#### Setup

##### `norn init`

Set up norn in this repo: detect the tracker, forge and executor, write the config, run doctor

```sh
norn init [--tracker <name>] [--forge <name>] [--store <name>] [--executor <harness>] [--runner <name>] [--mode auto|manual] [--commit] [--yes]
```

- `--tracker <name>`: the tracker plugin (detected: github when origin is on GitHub and gh is present, else local)
- `--forge <name>`: the forge plugin (detected: github with the github tracker, else none)
- `--store <name>`: where run state lives (default local)
- `--executor <harness>`: the default executor's harness (detected: claude when it is on PATH, else pi when it is)
- `--runner <name>`: where agents run (default headless; herdr when inside herdr and asked)
- `--mode auto|manual`: how agent steps start: auto on their own, manual when a person runs norn run start (default auto with the headless runner, else manual)
- `--commit`: write the committed config (.agents/norn.yaml, team mode) instead of the repo-local one (.agents/norn.local.yaml)
- `--yes`: take every detected choice without asking

##### `norn doctor`

Check the config, plugins, workflows, harness hooks and tools this repo needs, and bring the pack's skills in the checkout up to date

```sh
norn doctor [--repo]
```

- `--repo`: check only the repo's own config files (never the user's), plugins, slots and workflows; no hooks or tools (CI)

##### `norn config` (noun)

Read and change the config

##### `norn config get`

Print one config key of the merged config

```sh
norn config get <key>
```

##### `norn config set`

Set one config key in the repo-local file (the committed one with --commit)

```sh
norn config set <key> [<value>] [--commit] [--user] [--unset]
```

- `--commit`: write the committed config (.agents/norn.yaml)
- `--user`: write the user config (<norn home>/config.yaml)
- `--unset`: remove the key instead of setting it

##### `norn config show`

Print the merged config and which file set each key

```sh
norn config show
```

##### `norn plugin` (noun)

Install, list, update and remove plugins

##### `norn plugin add`

Install a plugin (npm spec, git URL or local path) and pin it in the lock

```sh
norn plugin add <spec>
```

##### `norn plugin list`

List the bundled and installed plugins and what each provides

```sh
norn plugin list
```

##### `norn plugin remove`

Unpin an installed plugin from this repo's lock

```sh
norn plugin remove <name>
```

##### `norn plugin update`

Update an installed plugin to the newest version its spec allows

```sh
norn plugin update <name>
```

#### A person's commands

##### `norn status`

Show every story and unit, read-only; --watch: the live cockpit; --segment: one line for herdr's tab bar

```sh
norn status | norn status --watch [--interval 5s] [--pane] | norn status --segment [--ttl 30s]
```

- `--watch`: the live cockpit: what needs you and every story, acted on by key; q or Esc quits
- `--interval <duration>`: with --watch: how often it reads the stories again (default 5s)
- `--pane`: with --watch: open it in a herdr pane below this one, leaving the focus here
- `--segment`: one line for herdr's tab bar, empty outside a norn repo; inside herdr also each story's $norn sidebar token
- `--ttl <duration>`: with --segment: how long a sidebar token stays without the next segment (default 30s)

##### `norn story` (noun)

Stories: list, view, create, the person's decisions, the next round, taking one to this machine, and updating a finished one's branch

##### `norn story list`

List the stories norn tracks

```sh
norn story list
```

##### `norn story view`

Show one story: its units, runs, gates and asks

```sh
norn story view <key>
```

##### `norn story create`

Create an item on the configured tracker (a GitHub issue, a local markdown file) with the intake label, so the next tick takes it in

```sh
norn story create <title> [--body <text>] [--workflow <name>]
```

- `--body <text>`: the item's body
- `--workflow <name>`: the workflow the story takes at intake

##### `norn story approve`

Approve the gate a story waits at

```sh
norn story approve <key> [--gate <step>] [--reason <text>]
```

- `--gate <step>`: the gate step, when the story waits on several
- `--reason <text>`: a comment kept on the decision

##### `norn story reject`

Reject the gate a story waits at, with the reason the next attempt gets

```sh
norn story reject <key> --reason <text> [--gate <step>]
```

- `--gate <step>`: the gate step, when the story waits on several
- `--reason <text>`: required: what failed; the agent sent back gets it

##### `norn story answer`

Answer the question a story's agent asked, or the permission or trust prompt in its pane

```sh
norn story answer <key> <text>   (a prompt in the pane: an option's number, yes or no)
```

##### `norn story round`

Start a story's next round on a workflow

```sh
norn story round <key> --workflow <name> [--at <step>] [--force] [--reason <text>]
```

- `--workflow <name>`: the workflow the round runs, pinned as it loads now
- `--at <step>`: the step the round starts at (default: the workflow's start)
- `--force`: end the round still under way first
- `--reason <text>`: why, kept on the record

##### `norn story take`

Take a story's claim to this machine, so its next tick carries the story on

```sh
norn story take <key> [--force] [--reason <text>]
```

- `--force`: take over a claim another machine holds, live or expired
- `--reason <text>`: why, kept on the record

##### `norn story update-branch`

Merge the base into a finished story's branch and push it, for its open change

```sh
norn story update-branch <key> [--reason <text>]
```

- `--reason <text>`: why, kept on the record

##### `norn story close`

Close a story and stop its runs

```sh
norn story close <key>
```

##### `norn run` (noun)

Runs: start one manual mode holds, stop a live one, run a step again, bring one's pane in front

##### `norn run start`

Start the agent of a step manual mode holds, or of an attended step

```sh
norn run start <unit>
```

##### `norn run stop`

Stop a unit's live run

```sh
norn run stop <unit>
```

##### `norn run rerun`

Run a unit's step again, or move it to another step, counters reset

```sh
norn run rerun <unit> [--step <step>] [--reset <counter>]... [--reason <text>]
```

- `--step <step>`: the step of the unit's pinned workflow to run (default: the step it is at)
- `--reset <counter>`: set a counter of the workflow back to 0 (repeatable)
- `--reason <text>`: why, kept on the record

##### `norn run attach`

Bring the pane of a unit's live run in front; --next: the agent waiting for you longest

```sh
norn run attach <unit> | norn run attach --next
```

- `--next`: the agent that has waited on you longest, without naming it

#### Background: run by a person, cron or a terminal multiplexer

##### `norn watch`

Tick on an interval until a signal stops it

```sh
norn watch [--interval <duration>] [--max-ticks <n>]
```

- `--interval <duration>`: the longest pause between ticks, as 30s or 2m (default 30s)
- `--max-ticks <n>`: stop after this many ticks; an interval paused below the store's version floor counts as one

##### `norn tick`

Run one tick: read facts, decide, act

```sh
norn tick
```

#### Agent protocol: the only commands an agent runs

##### `norn brief`

Print the brief of the step this agent runs

```sh
norn brief
```

##### `norn done`

Report the step done with an outcome

```sh
norn done <outcome> [--criteria <file>] [--findings <file>] [--note <text>] [--report-id <id>]
```

- `--criteria <file>`: the criteria report: a JSON array with one verdict per acceptance criterion; a step with `criteria: required` needs it
- `--findings <file>`: the findings to hand back: a JSON file, {"findings": [...]} or an array, each with a `title` and a `severity` (blocking, major, minor, nit); a step whose outcome hands back findings needs them or a note
- `--note <text>`: what the next step should know
- `--report-id <id>`: the report's id; a retry with the same id records it once

##### `norn ask`

Ask the person a question and wait for the answer

```sh
norn ask <question> [--report-id <id>]
```

- `--report-id <id>`: the report's id; a retry with the same id records it once

##### `norn stuck`

Report the step stuck, with the reason (a reason ending in ? is asked as a question)

```sh
norn stuck <reason> [--report-id <id>]
```

- `--report-id <id>`: the report's id; a retry with the same id records it once

#### Called by the harness's hooks, not by hand

##### `norn hook`

Answer a harness hook: the payload on stdin, the harness's reply on stdout

```sh
norn hook <harness> <hook>
```

#### Other

##### `norn help`

Show every command, or one command's usage

```sh
norn help [<command>]
```

##### `norn tidy`

Remove the worktrees and local branches of ended stories that no live claim holds, and close their runs' panes

```sh
norn tidy [--dry-run]
```

- `--dry-run`: list what would be removed and change nothing

### Config keys

Every file takes every key: the user file, the repo-local file and the committed file, the nearer winning.

| Key | Type | Default |
|---|---|---|
| `format` | `1` | `1` |
| `tracker.use` | string | none |
| `tracker.intake.label` | string | none |
| `tracker.intake.assignee` | string or null | `"me"` |
| `forge.use` | string | none |
| `store.use` | string | none |
| `vcs.use` | string | `"git"` |
| `executors.<name>.harness` | string | none |
| `executors.<name>.runner` | string or map | none |
| `executors.<name>.runner.use` | string | none |
| `executors.<name>.model` | string | none |
| `executors.<name>.args` | list of strings | none |
| `executor` | string | derived: the only executor |
| `packs` | list of strings (one) | `["sdlc"]` |
| `plugins.<name>` | string | none |
| `base` | string | `"main"` |
| `base_ref` | string | derived: the remote's fetched copy of `base` (`origin/main`), else `base` |
| `holder` | string | derived: user@ the machine's LocalHostName, else its hostname, fixed in `~/.norn/holder.json` on first use |
| `kernel.mode` | `"manual"` or `"auto"` | `"manual"` |
| `kernel.workflow` | string | `"story"` |
| `kernel.slice_workflow` | string | `"slice"` |
| `kernel.intake_workflow_label_prefix` | string | `"norn:wf:"` |
| `kernel.max_nudges` | integer ≥ 0 | `2` |
| `kernel.max_retries` | integer ≥ 0 | `1` |
| `kernel.silent_after` | duration | `"15m"` |
| `kernel.deadline` | duration or `"none"` | `"1h"` |
| `kernel.claim_ttl` | duration | `"10m"` |
| `kernel.claim_renew_before` | duration | `"400s"` |
| `kernel.lock_stale` | duration | `"10m"` |
| `kernel.counters.check_fail` | integer ≥ 1 | `5` |
| `kernel.counters.gate_reject` | integer ≥ 1 | `2` |
| `kernel.counters.conflict` | integer ≥ 1 | `2` |
| `kernel.counters.stale` | integer ≥ 1 | `10` |
| `kernel.counters.agent_back` | integer ≥ 1 | `3` |
| `trace.retain` | duration or `"keep"` | `"7d"` |
| `checks.<name>` | string | derived: `checks.test` is "bun test", which the shipped workflows' test steps run; init detects the repo's own |

Beside `use`, `tracker`, `forge`, `store`, `vcs`, `executors.<name>.runner` take the keys of the plugin they name; that plugin checks them.

### Shipped workflows

The `sdlc` pack's workflows:

- `quick`: Make a small change (refactor, docs, chore, a reproduced bug's fix), check and review it, open the draft PR, wait for CI.
- `refinement`: Agree a story's spec and plan with a person, against the current base; no code.
- `reproduce`: Reproduce a bug through the real interface, confirm its cause and the seam for a regression test; change no code.
- `slice`: Build one slice test-first, check and review it, and integrate it into the story branch.
- `story`: Slice a planned story against the current base, run the slices, verify the story, open the draft PR, wait for CI.
- `triage`: Check an issue still holds, add its context, and recommend what comes next (refinement, quick, reproduce) or closing it.

### Exit codes

| Code | Name | Meaning |
|---|---|---|
| 0 | `ok` | done |
| 1 | `error` | an unexpected failure: a bug or an IO error |
| 2 | `usage` | bad arguments |
| 3 | `refused` | a rule says no; `do_instead` says what would succeed |
| 4 | `corrupt` | a file norn keeps failed validation |
| 5 | `busy` | another process holds the lock or the claim |
| 6 | `config` | a config file a person wrote needs fixing |

<!-- norn:reference:end -->
