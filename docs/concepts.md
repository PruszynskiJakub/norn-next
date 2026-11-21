# Concepts

How norn works, for someone who has run a first story (the [README](../README.md) shows how). Every command named here is listed in [Reference](reference.md).

## Code decides, agents do

norn splits delivering a story into steps. An agent does one step at a time and reports how it ended: `norn done <outcome>`, `norn ask "<question>"` or `norn stuck "<reason>"`. It never names the next step. Plain code, the **tick**, reads the report and the workflow and decides what happens next.

- **Pull, don't trust.** Every tick gathers the facts again: the run data, the agents' hook events, git, the tracker's items and the forge's changes. A notification is never taken as truth, and a restarted heartbeat behaves the same.
- **Bounded everything.** Every retry, nudge and loop has a counter with a max. Going past it is a visible `stuck`, never an endless loop.
- **Receipts before effects, state last.** Every action with an effect outside norn writes a numbered receipt first, so a repeated tick never repeats the action; a unit's state is committed last, and a tick cut short at any point leaves either the old record or the new one, never a mix.

## A thin kernel and its plugins

norn is a small **kernel** (the workflow model, decide, the journal's write rules) and **plugins** that fill **slots**. A plugin reports facts and performs one effect per call; it never decides.

| Slot | What it is | Bundled |
|---|---|---|
| tracker | where stories come from | `github` (issues), `local` (markdown files on this machine) |
| forge | where a change is reviewed and merged | `github` (pull requests), `none` (a local record; you merge with git) |
| store | where run data lives | `local` (the machine dir), `refs` (git refs shared through the remote) |
| vcs | branches and worktrees | `git` |
| harness | the agent tool | `claude` (Claude Code), `pi` |
| runner | where an agent process runs | `headless` (a detached process), `herdr` (a Herdr pane) |
| step kinds | workflow steps beyond `agent`, `check`, `gate` and `slices` | `update-branch`, `integrate`, `push`, `verify-base`, `open-pr`, `await-merge` |
| pack | workflows and skills shipped together | `sdlc` |

An **executor** is a harness in a runner, under a name: `claude` in `headless`, say, or `pi` in `herdr`. A workflow step picks one with `by:`; without it, the config's default executor runs it. The bundled plugins ship in the binary; `norn plugin add <spec>` installs another (an npm spec, a git URL or a local path), and `norn plugin list` shows each plugin and what it provides.

The **runtime** hosts both: each tick it takes the lock, gathers the facts through the plugins, asks the kernel to decide, carries out each decision through the plugins, and writes the trace.

## Stories, slices and units

A **story** is a tracker item that carries the intake label (`norn`): on GitHub an issue assigned to you, with the local tracker any open item. A tick takes it in: a story branch, a worktree, and later a change (a draft PR on GitHub). Its key is the tracker's prefix and the item's number: `gh-12` on GitHub, `lt-3` with the local tracker.

A **slice** is a piece of a story, cut from the story's plan. It has its own branch and worktree and is merged back into the story branch when it is done. Its key is the story's plus a number: `gh-12/02`.

A **unit** is a story or a slice: anything that runs a workflow. Commands that act on a running step take a unit (`norn run start gh-12/02`); the person's decisions take the story (`norn story approve gh-12`).

## Workflows and steps

**Workflows are data.** A workflow is a YAML file: its steps, and for each step the outcomes it may end with and where each one leads. The pack ships them (`sdlc`: `triage`, `reproduce`, `refinement`, `story`, `slice`, `quick`, with the steps several share in `shared/`); a file in `.agents/workflows/` (or `.agents/workflows/shared/`) replaces the pack's file of the same name or adds a new one, and goes through the same checks. A story takes its workflow at intake, from its label `norn:wf:<name>`, else the config's default (`kernel.workflow`, `story` when unset). A unit pins its workflow when it starts, so editing a file never changes a story already in flight.

A **step** is one node of a workflow. Its head key says what happens there:

| Step | What happens |
|---|---|
| `agent:` | an agent does the step, told what it is for by the head's text and, when the step lists `skills:`, with those skills; `by:` picks the executor; it reports an outcome |
| `check:` | norn runs a command, such as your tests, in the unit's worktree; the exit code is the outcome (`pass` on 0, else `fail`, unless `exits` names another outcome for that code). Files it leaves there that git neither tracks nor ignores (a lockfile an install wrote, a report) are removed once it ends, and its output names them |
| `gate:` | a person decides: `approve` or `reject` |
| `slices:` | the story waits while its slices run, each with the slice workflow |
| `update-branch:`, `integrate:`, `push:`, `verify-base:` | git work by the vcs plugin: merge the base into the story (never a rebase), integrate a slice into the story branch, push, check the merged tree after the base moved |
| `open-pr:`, `await-merge:` | forge work: open the change (or rewrite its body), then wait for a person to merge it; the merge ends the story |

A step written `use:` brings in a shared file's steps, and `like:` copies another step. An **outcome** is how a step ended (`done`, `pass`, `fail`, `approve`, `stuck`, …). A step's `outcomes:` maps each outcome to the next step, `$done` or `$stuck`. Every route back (a failed test sends the story back to `implement`) carries a **counter** with a max, derived from the kind of edge and named `<step>.<outcome>`: a check's `fail` 5, a gate's `reject` 2, a `conflict` 2, `stale` 10, an agent sending work back 3. `max:` on an edge changes its bound, and the `kernel.counters` config keys change the defaults.

### Signals

A **signal** is a fact about the world outside a waiting step, which a tick reads: the base moved under the story (`stale`), the story branch holds commits its change lacks (`unpushed`), the step has waited too long (`timeout`). `outcomes:` says how a step ends by itself; a step's `on:` block says what may move it along while it waits, with the same route shape:

```yaml
ready:
  gate: "Read the draft PR. Approve to wait for the merge, or reject with what to change."
  outcomes:
    approve: merge
    reject:  { exit: rejected }
  on:
    stale:    { exit: stale }
    unpushed: open-pr
    timeout:  { after: 48h, to: remind }
```

- **Only waiting steps.** `on:` sits on a gate or a wait step kind (`await-merge`). A running agent or check is never moved by a signal, and `on:` on one is refused when the workflow loads.
- **Only declared signals.** The host reports `stale` and `unpushed` (from the vcs) and `timeout` (from the clock) itself; a plugin may declare more. A name no source declares is refused, and so is one under both `outcomes:` and `on:`.
- **Only the story.** A tick asks a source only for the story's own unit at a waiting step, and only for the signals under that step's `on:`. Slices get none.
- **Once per occurrence, per round.** Each signal names its occurrence with an id (the base commit for `stale`, the story head for `unpushed`, the step visit for `timeout`). One id moves the story once in a round; a new base move, a new push or a new visit is a new id. The first signal listed that is present wins, one per tick.
- **Endings and the step's own answer come first.** A merged change, a closed item or a closed change is decided before any signal, and a wait step kind's own outcome on the same tick wins over one.
- **Bounded.** An `on:` route back carries a counter named `<step>.<signal>`, bounded by the `stale` default (10) unless it sets `max:`.

A signal may carry a small `detail` (a failed check, a review's comments); the next agent step gets it as the `signal` input. A workflow written before `on:` routes `stale` and `unpushed` under a waiting step's `outcomes:`; it still loads, to the same graph, so a story that pinned it decides as before, and `norn doctor` warns about a repo file in that form.

## Who does what: attended steps, gates and modes

- An **attended step** (`attended: true`) is an agent step done *with* a person in the agent's pane. A person always starts it.
- A **gate** is a step with no agent: a person approves it (`norn story approve <story>`) or rejects it with what to change (`norn story reject <story> --reason "…"`), and the reason goes into the next attempt's brief.
- The **mode** says who starts the other agent steps. In **auto** mode norn starts the agent itself. In **manual** mode the step waits for a person, and `norn run start <unit>` starts it, for that step only. `norn init` picks auto with the headless runner, where nobody sits beside the agent, and manual with Herdr; a workflow's `mode` and `kernel.mode` in the config set it too.

Checks and the git and forge steps always run on their own. Gates, attended steps and a waiting merge always wait for a person, in either mode.

## What needs you

`norn status` shows every story and unit, the ones that wait for a person first: a gate to decide, a question to answer (`norn story answer <story> "…"`), a manual step to start, a stuck unit. A finished story (every unit ended done) is one line under Finished while its item is open and leaves the markdown once the item closed (`--json` still lists it), and its ticks decide nothing for it, but for one thing: when its change merges after it finished, the next tick takes the claim again to close its item. `norn story list` lists the stories and `norn story view <story>` shows one: the round it is in, its units with their worktrees, runs, gates and questions (a slice's key shows the story it belongs to). An agent that asks waits; a person's answer goes to the same session when it is still there, or to a fresh one with the answer in its brief.

## One tick

`norn watch` runs the heartbeat until Ctrl-C, which lets the tick in flight finish. It prints one line per tick that did something: the time and each action that moved a story or failed (a tick of only waiting prints nothing); `--json` prints every tick's report as a JSON line instead. `norn tick` runs one by hand. The interval (30 seconds, `--interval` changes it) is the longest watch waits, not the pace of a story:

- a tick that moved a story on is followed at once by up to three more, so a step that ends leads to the next one in the same moment. A tick that only waited (an agent or check still running, a unit parked or ended, a shared store's flush) pauses the whole interval;
- a receipt recorded during the pause by another process on this machine (`norn done`, `norn story answer`) or a check that finishes ends the pause within about a second. A receipt written on another machine arrives with the next tick's sync, and a step kind that waits across ticks (on the forge, say) is looked at again only at the next tick;
- before each tick watch reads the config, the plugin lock and the repo's workflows again, so a `config set`, a merged workflow or a `plugin add` counts from the next tick, with no restart. A new version of a plugin the watch already loaded takes a restart, since the process keeps the code it imported. A change that does not load leaves watch on the last config that did, and says so once on stderr.

Each tick:

1. **gathers** the facts: each unit's state and receipts from the store, the claims, the agents' hook events, git, the tracker's items and the forge's changes;
2. **decides**, with one pure function, the next action for each unit: take in a story, start an agent, nudge a silent one, run a check, take a reported outcome to the next step, push, open the change, finish the story;
3. **acts**: writes a receipt, then does the action through the plugin, then commits the unit's state last.

An agent that dies is retried; one that goes quiet is nudged; one that runs past its deadline is stopped. Each of these is bounded, and the last one leaves the unit stuck for a person.

## The agent's worktree

Each unit works in its own git worktree, made by the vcs plugin in the machine dir. Before a launch, norn puts there what the agent needs, all under `.agents/` and all ignored by git:

- **Skills.** The pack's skills go to `.agents/skills/<name>/`, linked from the harness's own folder (`.claude/skills/<name>`, `.pi/skills/<name>`), in every unit worktree before a launch and in the main checkout when `norn init` or `norn doctor` runs, so a person's own session finds the skills a person runs (`/norn-fsd`, `/norn-fsd-round`, `/norn-retro`, `/norn-triage`). They are ignored by git. A skill folder the repo commits, or a person keeps, under the same name is theirs and wins over the pack's.
- **The spec and the handoff.** The story's spec is `.agents/specs/<story>/spec.md`, mirrored from the tracker item; each unit's **handoff** is `.agents/specs/<story>/handoffs/<unit>.md`, the unit's current state in prose (goal, proof, what is easy to miss, notes, the next action), rewritten by whoever works on it. The agent edits both in place; norn reads them back when it reports, and keeps them with the run data, never on the branch.
- **Other inputs.** The last check's output, a rejection's findings and the like go to `.agents/inputs/`, rewritten for every run. A step lists the ones it reads under `inputs:`, by the names in [Reference › Inputs](reference.md#inputs).
- **Hooks.** The harness wires norn's hooks into the tool's local settings in that worktree (`.claude/settings.local.json` for Claude Code, an extension for pi). They feed norn the agent's events, keep it from ending a turn without a report, and refuse a file write outside the worktree or into norn's run state.

The branch, and the PR, hold only the code.

## Run data, claims and the end of a story

A unit's **run data** (its state, the numbered receipts, the pinned workflow, the story's spec and handoffs) lives in the configured **store**. With `local` it is in the checkout's machine dir, `~/.norn/repos/<id>/`, outside every worktree: removing a worktree or running `git clean -fdx` leaves the story where it was. With `refs` it is on git refs under `refs/norn/v2/`, pushed to the remote, so another machine sees the story and can take it over; each unit's branch is published beside it (`refs/norn/heads/<branch>`), so the machine that takes it over starts from the work.

Beside the run data, the machine dir keeps what is only for reading back: each tick's **trace** under `trace-v2/`, the hook events of each run under `events-v2/`, and session and check logs under `runtime/`. None of it needs a command to clean up. Every tick removes the traces older than `trace.retain` (a duration such as `12h` or `7d`; default `7d`; `keep` keeps them all), a bounded number per tick, so a long backlog drains over a few ticks. A finished story takes its units' logs with it. Folders left empty stay.

A **claim** gives one checkout the right to drive a story; the holder renews it each tick, and a checkout whose own claim expired takes it again. Another holder's claim, even an expired one, is never taken by a tick, since that checkout may still be acting on the story; a person moves it with `norn story take <story> --force`, and the takeover is kept on the story's record as a receipt. A **mailbox** carries a person's answer or gate decision to the holder when another machine holds the story: `norn story answer`, `approve` and `reject` send it there, and the holder's next tick imports it as the receipt it would have recorded itself.

When a story's last unit ends `done`, its tick **finishes** it: it closes the herdr panes their runs left open on this machine (attended ones too; herdr closes the story's workspace with its last one), removes the worktrees of the units that ended done, their local branches once every commit on them is on the story's branch, the base or the remote, and those units' logs (hook events, session logs, check logs), closes the tracker item once the story's change merged (when the tracker can), and gives up the claim. A unit that ended stuck keeps its worktree for you to look into, and a stuck story's item stays open; `norn tidy` closes the panes their runs left open and removes the worktrees and local branches of ended stories no live claim holds once you are done (never a pane norn did not launch), keeping any with uncommitted changes or commits on no other branch. `norn story close <story>` closes a story by hand and stops its runs. A change merged into a branch other than the configured `base` lands nothing on it: the story does not end, but parks at its step with a reason naming that branch and keeps its worktree for you to decide where the work goes.

A **round** is one run of a workflow over a story, from its first step to its end. A story's first round runs the workflow it took at intake. When a round ends without the change merging (a triage, a refinement, a reproduce round, or a stuck delivery), the item stays open, and you start the next round with `norn story round <story> --workflow <name>` (`--at <step>` to start at a step other than the workflow's first). The workflow is pinned as it loads at that moment. Counters start again at 0, and the next tick takes the claim again and makes the worktree again from the story's branch. A round still under way is refused unless you pass `--force`, which ends it first, on the record in your name. A story whose change merged or whose item is closed takes no new round: new work there is a new story.

Within a round, `norn run rerun <unit>` runs one unit's step again as a new attempt, and `--step <step>` sends it to another step of the workflow it pinned, a slice as well as a story. It takes up a unit that ended stuck, and stops a run still going before the move, so no agent works on at a step the unit left. Counters keep their values unless you name them with `--reset <counter>`. `norn status` and `norn story view` show each counter a unit has spent against its max, and a unit stuck on a counter that ran out names the rerun that resets it. A unit that ended done takes no rerun: new work there is a new round.

Between rounds, a story whose change is still open can fall behind its base. `norn story update-branch <story>` merges the base into the story branch (never a rebase) and pushes it, as a person's one-off act rather than a round. It holds the story's claim and the tick lock while it works, and records the update on the story's own unit through the act protocol, a `branch.update` intent before the merge and a `branch.updated` outcome after the push, neither of which changes the run state. An update cut short is finished by running the verb again. A conflicting merge is aborted and refused with its paths: resolving it is a round's work, through the workflow's update step. While a round is under way the verb is refused, since the round's own update steps keep the branch current.

## Config

Config comes in layers, each overriding the one before:

1. norn's defaults;
2. `~/.norn/config.yaml`: you, on this machine, for every repository;
3. `.agents/norn.local.yaml`: you, in this repository (kept out of git);
4. `.agents/norn.yaml`: the team's, committed.

The committed file wins over everyone's own, so a key it sets is the team's: `norn config set` still writes your file, but says when the committed file overrides what it wrote. With `--commit`, `norn init` leaves the mode out of the committed file and writes it to yours.

`norn init` writes `.agents/norn.local.yaml` (or `.agents/norn.yaml` with `--commit`) with every slot named: tracker, forge, store, the executors, the base branch and the mode, and the test command it detects from your build files as `checks.test`, which the shipped workflows' test steps run (default `bun test`): a JS repo's lockfile names its tool, and with none, bun when it is on PATH and a `package.json` script runs it, else npm, installing without writing a lockfile into the unit's worktree. `norn config show` prints the merged config and which file set each key, `norn config get <key>` one key and the file that set it, and `norn config set <key> <value>` changes one (in the local file, the committed one with `--commit`, the user file with `--user`). Each slot is `{use: <plugin name>, …}` with that plugin's own keys beside `use`; the plugin checks them. `norn doctor` checks the config, the plugins it picks, the workflows (a repo file that still routes `stale` or `unpushed` under a waiting step's `outcomes:` draws a warning naming the move to `on:`; a repo workflow naming a skill norn cannot find draws a warning, never a failure: a skill counts as found when the pack ships it or the repo keeps `<name>/SKILL.md` in `.agents/skills/` or a harness's skills folder, and a `plugin:skill` name is not looked for, since the harness may load either kind from outside the repo), the labels norn puts on items (defining any the tracker lacks), that each harness's hook line runs (outside a run, so not that a hook records its event), the pack's skills in the main checkout (written or brought up to date, those a newer pack dropped removed, a folder the repo keeps named), a shared store's run data against the remote's for every story this machine holds, the tools on PATH (git 2.38 or later, `gh` logged in for GitHub) and the git remotes a forge and the refs store push to, and says what to fix first; `norn watch` refuses an older git.

A config left by norn 0.35 or earlier is never read: its keys mean other things here. A repo's `.agents/norn.config.yaml` is refused with a pointer to `norn init`, which writes this norn's config from the keys it can map. An old `~/.norn/config.yaml` (top-level `mode`, `max_agents`) is refused the same way, and `norn init` rewrites it in place (`mode` under `kernel`; `max_agents` is left behind, since norn starts every due agent with no cap), keeping the old text as `config.yaml.old` and naming the keys it left behind.

## Glossary

| Term | Meaning |
|---|---|
| story | A tracker item with the intake label, taken in by a tick. One story branch, one story worktree, one change. |
| slice | A piece of a story with its own branch and worktree, merged back into the story. |
| unit | A story or a slice: anything that runs a workflow and has its own run data and handoff. |
| workflow | A YAML graph of steps, shipped in a pack or written in `.agents/workflows/`. |
| step | One node of a workflow, named by its head key: `agent`, `check`, `gate`, `slices`, or a plugin's step kind. |
| run | One attempt at a step; it produces receipts. |
| round | One run of a workflow over a story, from its first step to its end; a person starts the next with `norn story round`. |
| outcome | How a step ended, spelled as its reporter types it (`done`, `approve`, `stuck`, …). |
| counter | A bound on a retry, nudge or loop; past its max the unit is stuck. |
| gate | A step where a person approves or rejects. |
| signal | A fact about the world outside a waiting step (`stale`, `unpushed`, `timeout`), read on a tick and routed under the step's `on:`. |
| check | A step that runs a command; its exit code is the outcome. |
| attended step | An agent step done with a person in the pane. |
| mode | Who starts a story's unattended agent steps: a person (`manual`) or norn (`auto`). |
| receipt | An immutable, numbered record of something that happened to a unit, written before its effect. |
| claim | The right of one checkout to drive a story, kept in the store and renewed each tick. |
| mailbox | Where a person's answer or decision waits for the checkout that holds the claim. |
| handoff | `.agents/specs/<story>/handoffs/<unit>.md` in the worktree: the unit's current state, rewritten by whoever works on it, so anyone can continue. |
| brief | What `norn brief` tells the agent of a step: the work and its skills, why this attempt, how to report, what to read, and the rules. |
| tick | One pass of the heartbeat: gather facts, decide, act. |
| worktree | The git worktree a unit works in, made by the vcs plugin. |
| kernel | The pure core: the workflow model, decide and the journal's write rules. |
| plugin | A package that fills one or more slots. |
| slot | A kind of part a plugin provides: harness, tracker, forge, store, vcs, runner, step kind or pack. |
| pack | Workflows, shared files and skills shipped together as one plugin. |
| harness | The plugin for one agent tool (Claude Code, pi): its hooks, its launch, its events. |
| runner | Where an agent process runs: headless or a Herdr pane. |
| executor | A named harness in a runner, which an agent step runs on. |
| store | Where run data, claims and the mailbox live: the machine dir or git refs. |
| trace | The per-tick record of facts and decisions, kept outside the repository. |
| verdict | How one acceptance criterion fared in QA: `pass`, `fail`, `person` or `unverified`. |
