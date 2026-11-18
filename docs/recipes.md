# Recipes

What to do when something happens, and how to set norn up the way you work. Each recipe names what you see in `norn status` and the command that resolves it. Terms are explained in [Concepts](concepts.md), every flag in [Reference](reference.md).

## An agent asked a question

**You see:** the unit under "Needs you", waiting on the agent's question; `norn story view <story>` shows it in full.

```sh
norn story answer gh-18 "Keep the old endpoint and mark it deprecated in the docs"
```

The next tick delivers your answer to the same session, or starts a fresh session with the answer in its brief when the agent is gone. When several units of the story wait on an answer, the refusal names each one: answer by unit (`norn story answer gh-18/02 "…"`).

## A permission prompt blocks an agent

**You see:** a question that quotes the agent tool's prompt with its options.

```sh
norn story answer gh-18 "1"
```

Claude Code runs in its `auto` permission mode by default, so this is rare; an executor's `args` replaces that default whole ([Use another agent tool or model](#use-another-agent-tool-or-model)).

## A gate waits for you

**You see:** the unit waiting at a gate, with the gate's text: review the slice files, the PR, the QA verdicts.

```sh
norn story approve gh-17
norn story reject gh-17 --reason "Split slice 02: the migration and the endpoint are separate"
```

A rejection sends the unit back by the gate's `reject` route with your reason in the next attempt's brief, counted by the route's counter. When the story waits at more than one gate, name it with `--gate <step>`; `--reason` on an approval is kept with the decision.

## A step waits for you to start it

**You see:** an agent step ready to start, in manual mode.

```sh
norn run start gh-18/02
```

The next tick starts the agent for this step only; manual mode holds every later step again. An attended step always waits for this, in either mode, because a person works in the agent's pane.

## Stop an agent and steer it

```sh
norn run stop gh-18/02
norn story answer gh-18/02 "Stop rewriting the parser; only fix the off-by-one in tokenize()"
```

`norn run stop` parks the unit before it stops the run, so the stopped session is not read as died and retried. Your answer lifts the park and goes into the session.

## An agent died, hung or went quiet

norn handles this itself: an agent that dies is retried in a fresh session, one that goes quiet is nudged, one that runs past its deadline is stopped. Each is bounded (`kernel.max_retries`, `kernel.max_nudges`, `kernel.silent_after`, `kernel.deadline` in the config, or `retries`, `nudges` and `deadline` on the step). You only see it when the bound is reached and the unit is stuck.

## A unit is stuck

**You see:** the unit stuck, with its reason: the agent's own words from `norn stuck`, a counter at its max, or the runs that ran out.

Read `norn story view <story>` and fix the cause where it lies: a broken check command, a missing tool, a contradiction in the spec. A stuck unit keeps its worktree, and a stuck story keeps its item open. There is no command yet that sends a stuck unit back to a step ([Limitations](limitations.md)): close it with `norn story close <story>` and open a new item for the work that is left.

## Nothing moves

**You see:** an agent reported (`norn done`), but the story stays at the same step.

Nothing runs between ticks. Keep `norn watch` running while you work, or run `norn tick` once by hand. `norn doctor` says when the config, a plugin or a workflow keeps ticks from running, and what to fix first.

## Keep the heartbeat alive without a terminal

Run a tick from cron every minute in the repository:

```sh
* * * * * cd /path/to/repo && /usr/local/bin/norn tick >> /tmp/norn-tick.log 2>&1
```

A tick takes a lock, so a cron tick and `norn watch` take turns. cron has a minimal `PATH`: give full paths to `norn`, `gh` and your agent tool, or set `PATH` in the crontab.

## The base moved under a story

norn merges the base into the story branch in an `update-branch:` step, never by rebasing. When the merge conflicts, the shipped workflows send it to an agent step that resolves it, and the story goes on. A story waiting at a gate or at `await-merge:` goes back through its update step when the base moves under it in a way that conflicts (`base.stale` in the workflow). A base move without a conflict can still break the story; `base.verify: <check step>` runs that check on the merge of the base into the story head, once per base move, and sends the story back through update when it fails.

You may also push to the story branch yourself at any time: norn merges your push in and never loses it.

## Write your own workflow

1. Put a YAML file in `.agents/workflows/`. A file with the name of one of the pack's (`quick.yaml`) replaces it; a new name (`docs.yaml`) adds a workflow. Start from the pack's file of the same name.
2. Edit the steps. Each opens with one head key that says what happens (`agent:`, `check:`, `gate:`, `slices:`, or a step kind with no value such as `open-pr:`), then says where each outcome goes in `outcomes:`. An agent step's head is its orientation, what the step is for; `skills:` (optional) lists the skills it uses, `by:` picks an executor, `inputs:` what its brief gives it, and `means:` says what each routed outcome means:

```yaml
  implement:
    agent: Build the change the spec asks for, test-first.
    skills: [norn-implement]
    inputs: [spec, handoff, last_check]
    outcomes:
      done: test
    means:
      done: "every criterion has a passing test"
  test:
    check: npm ci && npm test
    timeout: 15m
    outcomes: { pass: review, fail: { to: implement, max: 3 } }
  ready:
    gate: Read the draft PR. Approve to wait for the merge, or reject with what to change.
    outcomes: { approve: merge, reject: implement }
```

3. Commit it, or keep it local: norn loads the files in `.agents/workflows/` of the main checkout. `norn doctor` shows a workflow that does not load, naming the file and the step.
4. Use it: label an item `norn:wf:docs`, or `norn story create "…" --workflow docs` with the local tracker.

A unit pins its workflow when it starts, so your edit applies to stories that start after it.

### Share steps between workflows

Steps that several workflows run the same way (the CI wait, the base update, opening the PR) go in a shared file, `.agents/workflows/shared/<name>.yaml`, which holds `start`, `steps` and an optional `description`. A route inside it names one of its own steps, `$done` or `$stuck`, or leaves through a named exit, `{ exit: <name> }`. A workflow brings it in with a step that holds only `use: <name>` and the routes for its exits:

```yaml
  ship:
    use: ship
    outcomes:
      ci-failed: { to: implement, max: 3 }
      rejected:  implement
      stale:     update
```

The shared steps keep their own names, so the brief and the record show `open-pr` and `ci`, never `ship`.

### Copy a step with `like:`

A step written `like: <step>` copies that step of the same file and replaces each key it writes, whole:

```yaml
  test-merge:
    like: test
    outcomes: { pass: open-pr, fail: implement }
```

### Bound a loop

Every route back to an earlier step is counted, and a unit whose counter passes its max is stuck. norn derives each counter from the kind of edge, named `<step>.<outcome>`:

| Edge | Default max | Resets |
|---|---|---|
| a check's `fail`, or an outcome its `exits` names, other than `stale` | 5 | never |
| a gate's `reject` | 2 | never |
| a `conflict` | 2 | on any other outcome of the same step |
| `stale`, on any kind of step | 10 | never |
| an agent outcome that sends work back on an otherwise uncounted loop | 3 | never |

`max:` on an edge replaces its default. To share one budget between edges, or reset it on chosen edges, write `counter: <name>` on them and declare it under `counters:` (`qa_loop: { max: 2, reset_on: human-qa.approve }`). The defaults for every workflow are the config's `kernel.counters` keys (`check_fail`, `gate_reject`, `conflict`, `stale`, `agent_back`).

## Name your own skill in a step

Write the skill under a name without the `norn-` prefix in `.agents/skills/<name>/SKILL.md`, commit it, and list it in the step: `skills: [my-review]`. To change how a pack skill works, commit your own folder under the pack skill's name: norn finds no mark of its own in it and leaves it alone, so your version is the one the agent loads.

## Run without GitHub

```sh
norn init --tracker local --forge none
norn story create "Add CSV export of orders" --body "Orders page, a button, all columns"
```

With the local tracker an item is a markdown file in the machine dir (or the folder its `dir` key names), and every open item with the intake label is a story, whoever wrote it. With forge `none`, the open-PR step writes a local record of the change; you review it and merge the story branch into the base with git, and the next tick sees the merge and finishes the story.

## Use another agent tool or model

An executor is a harness in a runner, under a name. Add one, make it the default, or pick it per step:

```sh
norn config set executors.pi "{harness: pi, runner: headless}"
norn config set executor pi
norn config set executors.claude.model opus
```

In a workflow, `by: pi` on an agent step runs that step on the `pi` executor. `args` on an executor replaces its harness's default arguments whole (Claude Code's are `--permission-mode auto`).

## Watch agents in Herdr panes

```sh
norn config set executors.claude.runner herdr
norn config set kernel.mode manual
```

The herdr runner opens one Herdr workspace per story and one tab per run, with the agent in its pane: you can watch it and type into it. With a person beside the agent, manual mode fits: start each agent step with `norn run start <unit>`. A decision given by typing into the pane is not on norn's record; give it with `norn story answer` too.

## Share run data with a team

```sh
norn config set store.use refs --commit
```

The `refs` store keeps run data, claims and the mailbox on git refs under `refs/norn/v2/`, pushed to the remote, so every clone sees each story's step and who holds it. Commit the config (`norn init --commit` writes `.agents/norn.yaml`) so the team runs the same tracker, forge, store and plugins; the plugin lock `.agents/norn.plugins.lock` pins the version of each installed plugin beside it.

## Write a plugin

A plugin is a package whose module exports one value made with `defineNornPlugin` from `@norn/plugin-api`:

```ts
import { defineNornPlugin } from "@norn/plugin-api";
import { linearTrackerFactory } from "./tracker.ts";

export const linearPlugin = defineNornPlugin({ name: "norn-linear", api: "^1", provides: { tracker: { linear: linearTrackerFactory } } });
```

It may fill any slot: `harness`, `tracker`, `forge`, `store`, `vcs`, `runners`, `stepKinds`, `packs`. A tracker, forge, store, vcs or runner is a factory with a `configSchema` and `create(ctx, config)`; it does its IO only through the `HostContext` it is given, and every call returns a `PluginResult`. Run the slot's suite from `@norn/conformance` (`trackerContract`, `forgeContract`, `storeContract`, `harnessConformance`) against it. Then:

```sh
norn plugin add ../norn-linear       # or an npm spec or a git URL
norn config set tracker.use linear
norn doctor
```

`norn plugin add` installs it into `~/.norn/plugins/` and pins it in the lock; a local path is linked, so your edits take effect at once. `norn plugin update <name>` moves it to the newest version its spec allows, `norn plugin remove <name>` unpins it.
