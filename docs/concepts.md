# Concepts

How norn works, for someone who has run a first story (the [README](../README.md) shows how). Every command and key named here is listed in [Reference](reference.md); the precise rules, with their ids, are in [`.agents/RULES.md`](../.agents/RULES.md).

## Code decides, agents do

norn splits delivering a story into steps. An agent does one step at a time and reports how it ended: `norn done <outcome>`, `norn ask "<question>"` or `norn stuck "<reason>"`. It never names the next step. Plain code, the **tick**, reads the report and the workflow and decides what happens next.

- **Pull, don't trust.** Every tick observes the agents, git, the files and the remote again. A notification is never taken as truth, and a restarted heartbeat behaves the same.
- **Bounded everything.** Every retry, nudge and loop has a counter with a max. Going past it is a visible `stuck`, never an endless loop.
- **Receipts before effects.** Every action with an effect outside norn writes a numbered receipt first, so a repeated tick never repeats the action, and every decision can be explained afterwards (`norn run view --why`).

## Stories, slices and units

A **story** is a GitHub or GitLab issue that carries the label `norn` and is assigned to you. `norn sync` takes it in: one spec folder (`.agents/specs/gh-N-<slug>/`), one story branch, one worktree, and later one draft PR. Its key is `gh-N` (`gl-N` on GitLab).

A **slice** is a piece of a story, cut from the story's plan. It has its own branch and worktree and is merged back into the story branch when it is done. Its key is the story's plus a number: `gh-18/02`.

A **unit** is a story or a slice: anything that runs a workflow. Commands that act on work take a unit (`norn story answer gh-18/02 "…"`, `norn run list gh-18`).

## Workflows, rounds and steps

**Workflows are data.** A workflow is a YAML file in `.agents/workflows/`: its steps, and for each step the outcomes it may end with and where each one leads. `norn init` writes six of them, and you can edit them or add your own (see [Recipes](recipes.md#write-your-own-workflow)). A unit pins its workflow when it starts, so editing a file never changes a story already in flight.

Each workflow does one thing, and a story goes through them as **rounds**, one after another on the same branch. A new story starts with the default workflow (`triage`), or the one its issue label names (`norn:wf:<name>`). A round ends at `$done`; only a person starts the next one, with `norn story edit <story> --workflow <name>`. The usual paths are a feature `triage → refinement → story`, a small change `triage → quick`, and a bug `reproduce → quick`.

A **step** is one node of a workflow. There are five kinds:

| Step | What happens |
|---|---|
| agent | an agent does the step with a skill (`norn-implement`, `norn-review`, …) and reports an outcome |
| check | norn runs a command, such as your tests; the exit code is the outcome (`pass` or `fail`) |
| git | norn does a git action: merge the base into the story (`update`), integrate a slice, open the draft PR, wait for CI |
| gate | a person decides: `approve` or `reject` |
| slices | the story waits while its slices run, each with its own workflow |

An **outcome** is how a step ended (`done`, `pass`, `fail`, `approve`, `stuck`, …). The workflow maps each outcome to the next step. A route back (a failed test sends the story back to `implement`) carries a **counter** with a max.

## Who does what: attended steps, gates and modes

Three things decide where a person comes in:

- An **attended step** (`attended: true`, such as refine and plan) is an agent step done *with* a person in the agent's pane. A person always starts it.
- A **gate** is a step with no agent: a person approves it or rejects it with what to change. The `ready` gate at the end of a delivery workflow is where you look at the PR before you merge it.
- The **mode** of a story says who starts its other agent steps. In **manual** mode (the default) the inbox shows the step as ready and how to start it. In **auto** mode norn starts the agent itself through the runner it detects: Herdr when norn runs inside Herdr or `herdr` is installed, otherwise headless. A story's mode is, nearest first: its own (`norn story edit <story> --auto|--manual` switches it), its workflow's `mode`, `mode` in your local or user config, then `manual`.

`check` and `git` steps always run on their own. Gates and attended steps always wait for a person, in either mode.

## The inbox

`norn status` is the inbox: everything that needs you, grouped by what you do about it, each item with its age and the exact command that resolves it.

| Group | What it holds |
|---|---|
| Your turn | an attended step to start or to come back to, or a manual step that is ready |
| Answer | an agent asked a question, or a permission prompt blocks it |
| Approve | a gate waits for you |
| Unblock | a step is stuck, an action failed, or a counter ran out |
| Check | something to look at: a story that conflicts with its base, a PR to merge |
| Unclaimed | a story no checkout drives |
| Running | agent steps in progress, for reference |
| Notes | questions an agent left without stopping the work |

For example, an Approve item shows the gate's instruction and `norn story approve gh-17`, because the workflow's gate waits for a person. `norn status --watch` keeps the inbox on screen as a cockpit that acts on items by key.

## One tick

`norn watch` runs the heartbeat: a tick every 30 seconds (`norn tick` runs one by hand). Each tick:

1. **observes** the facts: the units' state files and receipts, the agents' hooks and runner panes, git, and every few minutes the remote's issues and PRs;
2. **decides**, with one pure function, the next action for each unit: start an agent, nudge a silent one, run a check, take a reported outcome to the next step, push, notify;
3. **acts**: writes a receipt, then does the action, then writes the unit's `state.json` last.

An agent that dies is classified `died` and retried; one that goes quiet is nudged; one that runs past its deadline is stopped. Each of these is bounded by a counter, and the last one lands in the inbox.

## What gets committed

A unit's run state lives in its spec folder, under `runs/`: `state.json`, the numbered receipts, the pinned workflow, logs of failed checks, QA evidence and `handoff.md`. norn commits it with the agent's work at each step boundary and pushes the branch, so anyone can take a story over from any commit (`norn story checkout`). `runs/` is marked as generated, so GitHub and GitLab collapse it in the PR diff.

Per-tick detail (the trace, locks and caches) stays outside the repository, in one folder per checkout under `~/.norn/repos/`. `norn run list` and `norn run view --why` read it.

## Skills

A step's craft is in a skill: `norn init` copies norn's skills into `.agents/skills/` and links them from each agent's skill folder. The `norn` skill is the protocol every step follows (read the brief, work in scope, report once); the others do one kind of step each. To change how a step is done, write your own skill under another name and name it in the step (`skill: my-review`). `norn doctor` reports skills that are missing, not linked or out of date.

## Glossary

| Term | Meaning |
|---|---|
| story | A remote issue (GitHub or GitLab) assigned to you with the label `norn`. One spec folder, one story branch, one story worktree, one draft PR. |
| slice | A piece of a story with its own branch and worktree, merged back into the story. |
| unit | A story or a slice: anything that runs a workflow and owns a `runs/<unit>/` folder. |
| workflow | A YAML (or JSON) graph of steps, in `.agents/workflows/`. |
| round | One workflow applied to a story, from its start step to `$done`. A story goes through one or more rounds; a slice runs one workflow. |
| step | One node of a workflow: agent, check, git, gate or slices. |
| run | One attempt at a step; it produces receipts. |
| outcome | How a step ended, spelled as its reporter types it (`done`, `approve`, `stuck`, …). |
| counter | A named bound on a retry, nudge or loop; past its max the unit is stuck. |
| gate | A step where a person approves or rejects. |
| check | A step that runs a command; its exit code is the outcome. |
| attended step | An agent step done with a person in the pane. |
| mode | Who starts a story's unattended agent steps: a person (`manual`) or norn (`auto`). |
| receipt | An immutable, numbered record of something that happened to a unit, written before its effect. |
| claim | A git ref that gives one checkout the right to drive a story. |
| handoff | `handoff.md` in a unit's `runs/`: goal, progress and the next action, so anyone can continue. |
| brief | What `norn brief` tells the agent of a step: where it is, the skill, the inputs and how to report. |
| inbox | Everything that needs a person, with the command that resolves each item (`norn status`). |
| tick | One pass of the heartbeat: observe, decide, act. |
| worktree | The git worktree a unit works in. |
| slot | A numbered port range a running unit gets, so parallel units do not collide. |
| trace | The per-tick record of facts and decisions, kept outside the repository. |
| mailbox | A git ref through which another checkout sends an answer or approval to the one that holds the claim. |
| verdict | How one acceptance criterion fared in QA: `pass`, `fail`, `person` or `unverified`. |
| note | A question for a person left with a `norn done` report; it never stops the work. |
