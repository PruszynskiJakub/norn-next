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

## Labels

norn reads and writes a few labels on your issues. `norn init` and `norn upgrade` create each one that is missing on the remote, in norn's colour (`#5319E7`) with a description; they never change or delete a label that is there. `norn doctor` warns about a missing one and names `norn upgrade`. A `norn:wf:<name>` label that names no workflow is listed as unused, with the command to delete it: norn deletes nothing, because deleting a label strips it from every issue. When the remote cannot be reached or written (no git remote, `gh`/`glab` missing or logged out, no permission), `init` and `upgrade` still finish and say what to run.

| Label | Meaning |
|---|---|
| `norn` | norn takes in the issue once it is assigned to you |
| `norn:wf:<name>` | the first workflow the story runs; one per valid workflow in `.agents/workflows/` |
| `norn:kind:bug`, `feature`, `security`, `chore`, `docs` | what the issue is: something broken, new or changed behaviour, a vulnerability or hardening, maintenance, documentation only |
| `norn:risk:low`, `medium`, `high` | how much the change could break: a two-way door with a small blast radius, one touching shared code or behaviour, a one-way door or a wide blast radius |
| `norn:priority:low`, `medium`, `high`, `extreme` | can wait, soon, next (it blocks work now), drop other work |

The kind, risk and priority labels are for you, to filter and sort the backlog: the triage agent puts one of each on the issue and gives its reasons in the `## Triage` comment, and keeps a label that is already there (yours, or an earlier triage's), saying in the comment what it would pick instead. norn itself never reads them.

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

## What gets committed, and where run state lives

A step boundary commits only the agent's work and the unit's handoff, `handoffs/<unit>.md` in the spec folder (`_story.md` for the story, `<nn>-<slug>.md` for a slice), and pushes the unit's branch. A story's PR holds the code, the spec and the handoffs, nothing of norn's own. A handoff is prose only (Goal, Progress, Resume): the status it used to carry (step, attempt, counters, last outcome) is printed by `norn brief` and `norn story checkout` above it. Each boundary commit carries trailers naming the story, slice and step; one that ends a step also names its outcome and the step it led to (`Norn-Outcome`, `Norn-Next`), which is what another machine reads as the story's last boundary.

A unit's **run state** (`state.json`, the numbered receipts, the pinned workflow, logs of failed checks and QA evidence) lives on the machine that runs the story, in the checkout's machine dir: `~/.norn/repos/<id>/runs/<story>/<unit>/`. Nothing in a worktree or in git holds it, so removing a worktree or running `git clean -fdx` leaves the story where it was.

When the record has to leave the machine, norn packs the story's whole run state into one commit on the ref `refs/norn/runs/<story>` on the remote, which no branch and no normal clone carries. The team config's **record policy** (`record.policy`) says when:

- `local` (the default): when the claim is released (`norn story handoff`, a clean `norn watch` exit, `norn story close`), each time the `open-pr` step opens or updates the PR (so the PR body can link QA evidence at that record commit), and once at the end, when the PR merges or the story closes without one.
- `remote`: at every step boundary as well, right after the branch. Another machine then always sees the current step and attempt, and can take the story over with its full record even if the holder dies.

A finished story's record stays on its ref, so `norn run list` and `norn run view` read it on any machine; the base branch never receives run state. Per-tick detail (the trace, locks and caches) stays in the machine dir too; `norn run view --why` reads it. A repository whose base branch still holds run state from an older norn is pointed to `norn upgrade`, which moves it into the refs ([Recipes: Roll out a new norn to a team](recipes.md#roll-out-a-new-norn-to-a-team)).

On a machine that does not hold the story, `norn status` and `norn story view` show what that machine can know: under `remote`, the step, attempt and counters read from the ref; under `local`, the claim, the branch, the PR and its CI and the last boundary step, with a line saying whose machine holds the record. A ref no longer kept current is shown with its age ("record as of …"). An answer or approval sent from such a machine goes through the mailbox and is checked on the holder; one the holder turns away (the story moved on) shows there as a Check item.

How handover and takeover work, with and without a record on the ref, is in [Recipes: Hand a story over](recipes.md#hand-a-story-over).

## Skills

A step's craft is in a skill: `norn init` copies norn's skills into `.agents/skills/` and links them from each agent's skill folder. The `norn` skill is the protocol every step follows (read the brief, work in scope, report once); the others do one kind of step each. To change how a step is done, write your own skill under another name and name it in the step (`skill: my-review`). `norn doctor` reports skills that are missing or not linked, and fails on a bundled skill that differs from the running norn's copy.

A bundled skill (a `norn`-prefixed folder in `.agents/skills/`) that differs from the running norn's copy is **drift**: norn starts no agent step in a unit whose worktree holds drifted skills, so an agent never follows a protocol from another norn than the one it reports to. Gates, checks, base syncs and merges of that unit go on; `norn brief`, `norn story start` and `norn story chat` refuse there, and the inbox names the fix (`norn story update-branch <story>` for a unit, `norn upgrade` and a commit when the main checkout drifted). Your own skills, without the `norn-` prefix, are never checked.

## The repo's norn version

The team config records **the repo's norn version** (`norn_version: X.Y.Z` in `.agents/norn.config.yaml`): the norn the repo was set up with or last upgraded to. A binary matches it when it is the same minor (before 1.0; the same major from 1.0 on) and at least that patch: a repo at `X.Y.Z` takes `X.Y.Z` and any later patch of `X.Y`, never an earlier patch, never another minor. A patch upgrade of the binary needs no commit; a new minor, which may change how norn reads the config, the workflows or the run state, needs `norn upgrade` and a commit.

The version is read from the main checkout's team config, so it changes for you when you pull the base branch, not before. With a binary that does not match:

- every command that acts is refused with exit code 3 (`refused`) and the norn to install, or `norn upgrade` when your binary is newer: `tick`, `watch` (each tick), `sync`, `brief`, `tidy`, `config set|unset`, every `story` verb that changes something, and `run rerun|cancel|attach`. Nothing is written, launched or pushed.
- the commands that only read run and show the mismatch: `help`, `--version`, `doctor`, `status` (a top Unblock item, and the tab bar line), `story list|view|wait`, `run list|view`, `config list|get`.
- `init`, `upgrade`, `uninstall`, and the reports an agent already in a step makes (`done`, `ask`, `stuck`, `hook`, and the check runs a tick started), are never refused for it, so a session already started can always report.

A repo without the key works as before; `doctor` and `status` hint to run `norn upgrade`. How to move a team to a new norn is in [Recipes: Roll out a new norn to a team](recipes.md#roll-out-a-new-norn-to-a-team).

## Glossary

| Term | Meaning |
|---|---|
| story | A remote issue (GitHub or GitLab) assigned to you with the label `norn`. One spec folder, one story branch, one story worktree, one draft PR. |
| slice | A piece of a story with its own branch and worktree, merged back into the story. |
| unit | A story or a slice: anything that runs a workflow and has its own run state and handoff. |
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
| handoff | `handoffs/<unit>.md` in the spec folder, on the unit's branch: goal, progress and the next action, so anyone can continue. |
| run state | A unit's state, receipts, pinned workflow, logs and evidence, kept in the checkout's machine dir (`~/.norn/repos/<id>/runs/`), never in git. |
| record | A story's run state packed into one commit on `refs/norn/runs/<story>` on the remote: pushed on a claim release, by `open-pr`, at the end, and under `remote` at every boundary. |
| brief | What `norn brief` tells the agent of a step: where it is, the skill, the inputs and how to report. |
| inbox | Everything that needs a person, with the command that resolves each item (`norn status`). |
| tick | One pass of the heartbeat: observe, decide, act. |
| worktree | The git worktree a unit works in. |
| norn version | The norn version a repo was set up with or last upgraded to (`norn_version` in the team config); a binary of another minor, or an earlier patch, refuses to act on the repo. |
| slot | A numbered port range a running unit gets, so parallel units do not collide. |
| trace | The per-tick record of facts and decisions, kept outside the repository. |
| mailbox | A git ref through which another checkout sends an answer or approval to the one that holds the claim. |
| verdict | How one acceptance criterion fared in QA: `pass`, `fail`, `person` or `unverified`. |
| note | A question for a person left with a `norn done` report; it never stops the work. |
