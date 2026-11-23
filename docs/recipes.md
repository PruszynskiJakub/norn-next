# Recipes

What to do when something happens, and how to set norn up the way you work. Each recipe names what you see in `norn status` and the command that resolves it. Terms are explained in [Concepts](concepts.md), every flag in [Reference](reference.md).

## An agent asked a question

**You see:** the unit under "Needs you", waiting for `answer` on the agent's question (`parked: agent.asked` in `--json`, the question in `waiting.text`); `norn story view <story>` shows it in full. An agent that reports `norn stuck` with a question (its reason ends in `?`) is asking it, and waits here too.

```sh
norn story answer gh-18 "Keep the old endpoint and mark it deprecated in the docs"
```

The next tick delivers your answer to the same session, or starts a fresh session with the answer in its brief when the agent is gone. When several units of the story wait on an answer, the refusal names each one: answer by unit (`norn story answer gh-18/02 "…"`).

## A permission prompt blocks an agent

**You see:** the unit waiting for a permission, with the call it asks about and the agent tool's prompt: `Bash(rm -rf build): Claude needs your permission to use Bash`.

```sh
norn story answer gh-18 1     # the first option, which lets it run; `no` refuses it
```

The next tick presses the keys for that option in the agent's pane; after a `no` it also tells the agent the call was refused, so it goes on without it. Only a runner with a pane can do that (herdr); in a headless run, rerun the step instead. Claude Code runs in its `auto` permission mode by default, so this is rare; an executor's `args` replaces that default whole ([Use another agent tool or model](#use-another-agent-tool-or-model)).

## An agent in a pane sends nothing

**You see:** the unit waiting for a permission: its agent waits on a dialog in its pane, with the dialog's text (a trust prompt for the new worktree, as herdr reads it off the pane on the next tick), or, where the pane cannot be read, it has sent no event for the silent window and most likely sits behind such a prompt.

Trust the folder in the pane, or answer the prompt from here:

```sh
norn story answer gh-18 yes   # the option that trusts the folder, wherever the menu lists it
```

norn reads the pane to find that option; where it cannot read the pane, or the menu has no option that says yes, `yes` is refused and you answer with the option's number as the pane shows it. The run goes on with its first event. If the pane shows something else, start the step again with `norn run rerun gh-18`.

## A gate waits for you

**You see:** the unit waiting at a gate, with the gate's text: review the slice files, the PR, the QA verdicts.

```sh
norn story approve gh-17
norn story reject gh-17 --reason "Split slice 02: the migration and the endpoint are separate"
```

A rejection sends the unit back by the gate's `reject` route with your reason in the next attempt's brief, counted by the route's counter. When the story waits at more than one gate, name it with `--gate <step>`; `--reason` on an approval is kept with the decision.

## Start a story's next round

**You see:** a round ended without a change to merge. A triage round ended with the outcome it recommends (`refinement`, `quick`, `reproduce`, `fix` or `close`), a reproduce round posted its findings, a refinement round agreed the plan, or a delivery round ended stuck with `replan`.

```sh
norn story round gh-17 --workflow refinement
norn story round gh-17 --workflow refinement --at plan --reason "the base no longer fits the plan"
norn story round gh-17 --workflow story --force   # end the round under way first
```

The workflow is pinned as it loads now, from the pack and `.agents/workflows/`. `--at` names the step the round starts at, and counters start at 0. The next tick takes the story up again, makes its worktree again from the story branch, and starts the step. Refused: a round still under way without `--force`, and with `--force` while an agent runs (`norn run stop` it first) or a slice is unfinished. Also refused: a story whose change merged or whose item is closed (create a new story for new work), and a story another machine holds.

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

`norn run stop` parks the unit before it stops the run, so the stopped session is not read as died and retried. Your answer lifts the park and goes into the session. Run it on the machine that holds the story: elsewhere it is refused (`claim_held`), as the session lives on the holder's machine.

## An agent died, hung or went quiet

norn handles this itself: an agent that dies is retried in a fresh session, one that goes quiet is nudged, one that runs past its deadline is stopped. Each is bounded (`kernel.max_retries`, `kernel.max_nudges`, `kernel.silent_after`, `kernel.deadline` in the config, or `retries`, `nudges` and `deadline` on the step; a workflow's `defaults.stalled` replaces `kernel.silent_after` for its own steps). You only see it when the bound is reached and the unit is stuck. An agent that exits before its first event or before it acted (a bad flag, a missing login) is read as died, and the reason it ends with, on its retry too, is the head of its log.

## A unit is stuck

**You see:** the unit stuck, with its reason: the agent's own words from `norn stuck`, a counter at its max, or the runs that ran out.

Read `norn story view <story>` and fix the cause where it lies: a broken check command, a missing tool, a contradiction in the spec. A stuck unit keeps its worktree, and a stuck story keeps its item open. Then run its step again, or send it to an earlier step with the counter that ran out back at 0:

```sh
norn run rerun gh-18/02
norn run rerun gh-18/02 --step implement --reset check.fail --reason "test command fixed"
```

The unit keeps the workflow it pinned: `--step` names one of its steps and `--reset` one of its counters (both are refused otherwise, naming the ones it has). The next tick takes the story up again and the unit enters the step as a new attempt. When a slice stuck, its story usually ended stuck at its `slices` step too: rerun the slice first, then the story at that step (`norn run rerun gh-18 --step slices`), so the story waits for the slice instead of seeing it stuck again. To start over on another workflow, start a new round instead ([Start a story's next round](#start-a-storys-next-round)).

## Run a step again

```sh
norn run rerun gh-18/02                          # the step it is at, as a new attempt
norn run rerun gh-18 --step review --reason "review the rebased diff"
```

Any unit that has not ended done takes a rerun: a stuck one, a parked one, one at a gate, one whose agent is still at work. A live run (an agent session, a running check) is stopped by the next tick before the move, so nothing goes on working at a step the unit left; the tick after applies the move. Counters keep their values unless you name them with `--reset`, so a loop at its max ends stuck again on the same outcome. Refused: a unit that ended done (new work on the story is a new round), a corrupt one, a story whose change merged or whose item is closed, a story another machine holds, and a unit with receipts the next tick has not applied yet (`norn tick`, then rerun).

## Nothing moves

**You see:** an agent reported (`norn done`), but the story stays at the same step.

Nothing runs between ticks. Keep `norn watch` running while you work, or run `norn tick` once by hand. `norn doctor` says when the config, a plugin or a workflow keeps ticks from running, and what to fix first.

## Keep traces longer, or for good

**You see:** the trace of a tick you want to read back is gone from `~/.norn/repos/<id>/trace-v2/`.

Every tick removes the traces older than a week. Keep more with a longer duration, or all of them with `keep`:

```sh
norn config set trace.retain 30d
norn config set trace.retain keep
```

A done story's hook events and session and check logs go when the story is finished, whatever `trace.retain` says; a stuck unit keeps them with its worktree.

## Keep the heartbeat alive without a terminal

Run a tick from cron every minute in the repository:

```sh
* * * * * cd /path/to/repo && /usr/local/bin/norn tick >> /tmp/norn-tick.log 2>&1
```

A tick takes a lock, so a cron tick and `norn watch` take turns. cron has a minimal `PATH`: give full paths to `norn`, `gh` and your agent tool, or set `PATH` in the crontab.

## The base moved under a story

norn merges the base into the story branch in a `vcs.update-branch` step, never by rebasing. When the merge conflicts, the shipped workflows send it to an agent step that resolves it, and the story goes on. A story waiting at a person step or at `forge.await-merge` goes back through its update step when the base moves under it in a way that conflicts (`signals: { vcs.stale: { when: conflict } }` in the workflow). A base move without a conflict can still break the story; `verify: <shell step>` beside `when:` runs that check on the merge of the base into the story head, once per base move, and sends the story back through update when it fails.

You may also push to the story branch yourself at any time: norn merges your push in and never loses it.

## Update a finished story's branch

**You see:** a story's round ended (`done` or `stuck`) with its change still open, and the change now conflicts with its base or lags it.

```sh
norn story update-branch gh-17 --reason "main moved under the open PR"
```

norn merges the base (`base_ref`, else the remote's copy of `base`, after a fetch) into the story branch with a merge commit, never a rebase, and pushes it. Commits on the change the branch lacks, such as an "update branch" pressed on the forge, are merged in first, so the push goes through. It works under the story's claim, taken when nobody holds it and given up again when done, and under the tick lock, so no tick finishes the story mid-merge. The update is on the story's record, as an intent written before the merge and its outcome after the push: `norn story view gh-17` lists it, and the next tick applies that record. For a story that ended done that tick removes the worktree again; a stuck story keeps it until the story ends done. If the update is cut short after the intent (a crash, a failed push), run the verb again: it finishes that update under the same intent, so it is recorded even when the branch already holds the base.

When the merge conflicts, norn aborts it and refuses with the conflicting paths (`code: conflict`). A conflict a trial merge finds is refused before anything moves or is recorded. One found only by the real merge, after the change's head was merged in first, leaves that first merge on the local branch, unpushed, and says so (`details.moved_to`); the remote stays as it was. Its `do_instead` names a round whose update step resolves conflicts with an agent (the norn-merge skill), such as `norn story round gh-17 --workflow story --at update`. Refused too: a round under way (its own update steps keep the branch current), a story with no open change, a merged or closed change, and a story another machine holds (`norn story take` it first).

## Write your own workflow

1. Put a YAML file in `.agents/workflows/`. A file with the name of one of the pack's (`quick.yaml`) replaces it; a new name (`docs.yaml`) adds a workflow. Start from the pack's file of the same name.
2. Edit the steps. Each says who acts with `by:` (an agent role, `person`, `shell`, or a step kind such as `forge.open-pr`), what they do with `do:`, and where each outcome goes in `outcomes:`. An agent step's `do:` is its orientation, what the step is for; `with: { skills: […] }` (optional) lists the skills it uses, `reads:` what its brief gives it (the names are in [Reference › Inputs](reference.md#inputs)), each outcome's `means:` says what it means, and its role says what it may do, which `allow:` may narrow ([Concepts](concepts.md#what-an-agent-step-may-do)). An outcome is a bare target, or an object with its target and what it means, its bound and what it produces ([Reference › Outcomes](reference.md#outcomes)); every key is in [Reference › Steps](reference.md#steps):

```yaml
  implement:
    by: builder
    do: Build the change the spec asks for, test-first.
    with: { skills: [norn-implement] }
    reads: [spec, handoff, last_check]
    outcomes:
      done: { to: test, means: "every criterion has a passing test" }
  test:
    by: shell
    do: "{checks.test}"
    limits: { timeout: 15m }
    outcomes: { pass: review, fail: { to: implement, max: 3 } }
  ready:
    by: person
    do: Read the draft PR. Approve to wait for the merge, or reject with what to change.
    outcomes: { approve: merge, reject: implement }
```

   A shell step's `do:` is a shell command. `{checks.<name>}` in it stands for the command the config sets under that name: the pack's test steps run `{checks.test}`, which `norn init` detects from your build files and `norn config set checks.test "npm test"` changes (default `bun test`). What the check needs installed goes in `setup` (`norn config set setup.command "npm ci"`), which norn runs once in each new worktree rather than on every check ([Reference › Worktree setup](reference.md#worktree-setup)).
3. Commit it, or keep it local: norn loads the files in `.agents/workflows/` of the main checkout. `norn doctor` shows a workflow that does not load, naming the file and the step.
4. Use it: label an item `norn:wf:docs`, or `norn story create "…" --workflow docs` with the local tracker.

A unit pins its workflow when it starts, so your edit applies to stories that start after it.

### Share steps between workflows

Steps that several workflows run the same way (the build loop, the base update, publishing the PR, landing it) go in a shared file, `.agents/workflows/shared/<name>.yaml`, which holds `start`, `steps` and an optional `description`. A route inside it names one of its own steps, `$done` or `$stuck`, or leaves through a named exit, `{ exit: <name> }`. A workflow brings it in with a step that holds only `use: <name>` and the routes for its exits:

```yaml
  publish:
    use: publish
    outcomes:
      passed: land
      failed: { to: build, max: 3 }
      stale:  base-update
```

The shared steps keep their own names, so the brief and the record show `describe`, `open-pr` and `checks`, never `publish`. A route to the use step enters the file at its `start`; a route may also name one of its steps, as a base update's light path names `open-pr` to skip `describe`. Name the use step after its file (`publish: { use: publish }`), so a route to it reads as the file it enters. The pack ships `catch-up` (merge the base before the work starts; exit `synced`), `diagnose` (the reproduce step that `reproduce` and `fix` share; exits `reproduced`, `cannot_reproduce`), `build` (implement, the `check` step running `{checks.test}`, and the review; exit `reviewed`, and every rework of a quick, fix or story round goes through it before the base update), `base-update` (merge the base after the work and test the merged tree; exits `tested`, `failed`, `merged` for the light path, `redescribe`), `publish` (describe, open the draft PR, wait for its checks; exits `passed`, `failed`, `stale`) and `land` (the person's `ready`, then the merge; exits `rejected`, `stale`, `unpushed`).

### Wait for a pull request's checks

`by: forge.await-checks` waits for the checks on the story's change, polled every tick, so nothing blocks while CI runs. It answers `pass` when every check passed, `fail` when one failed, naming each failed check and its link in the next agent's `last_check` and under Rework (never a log), and `stale` when the change conflicts with its base, since GitHub runs no checks on such a pull request. A forge with no checks (`none`) passes at once; a change that shows no check within `appear` (5m) passes as a repo without CI, and checks still pending after `settle` (30m) fail:

```yaml
  checks:
    by: forge.await-checks
    with: { appear: 10m, settle: 1h }
    outcomes: { pass: ready, fail: { to: implement, max: 3 }, stale: update }
```

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

Write the skill under a name without the `norn-` prefix in `.agents/skills/<name>/SKILL.md`, commit it, and list it in the step: `with: { skills: [my-review] }`. A skill a step lists that neither the pack ships nor the repo keeps (in `.agents/skills/` or a harness's skills folder) draws a warning from `norn doctor`; the tick still runs the workflow, because the harness may load the skill from a user-level folder or a plugin (`plugin:skill`, which is not looked for). To change how a pack skill works, commit your own folder under the pack skill's name: norn finds no mark of its own in it and leaves it alone, so your version is the one the agent loads.

## Run without GitHub

```sh
norn init --tracker local --forge none
norn story create "Add CSV export of orders" --body "Orders page, a button, all columns"
```

With the local tracker an item is a markdown file in the machine dir (or the folder its `dir` key names), and every open item with the intake label is a story, whoever wrote it. With forge `none`, the open-PR step writes a local record of the change; you review it and merge the story branch into the base with git, and the next tick sees the merge and finishes the story.

## Use another agent tool or model

An executor is a harness and a model, under a name. Add one, make it the default, bind a role or one step to it, or give a role a list to fall back on:

```sh
norn config set executors.pi "{harness: pi}"
norn config set executor pi
norn config set executors.claude.model opus
norn config set bind.reviewer pi                 # every reviewer step
norn config set bind.story.review claude         # the story workflow's review step only
norn config set bind.builder "[claude, pi]"      # the first that can run the step
```

`args` on an executor replaces its harness's default arguments whole (Claude Code's are `--permission-mode auto`). An executor without a `runner:` of its own runs in the runner `runners:` picks for the step's attendance ([Reference › Executors and runners](reference.md#executors-and-runners)). A workflow in the older form names an executor for one step with `by: <executor>` beside `agent:`.

## Watch agents in Herdr panes

```sh
norn config set runners.person herdr             # attended steps, where you work beside the agent
norn config set runners.none herdr               # every other step too, to watch it
norn config set kernel.mode manual
```

An executor that names a `runner:` of its own (`executors.claude.runner herdr`, as `norn init` writes it) runs every step there instead.

The herdr runner opens one Herdr workspace per story and one tab per run, labelled `<unit> <step>`, with the agent in its pane: you can watch it and type into it. A run norn stops (its report applied, a retry, a deadline) ends its agent and keeps its tab, so every run of a story, attended or not, is a tab in the story's one workspace. The story's finish closes the tabs of its units that ended done, and the workspace with the last one; `norn tidy` closes the rest once the story ended. In auto mode norn starts each agent step in its pane on its own, and you can look in or type at any time; in manual mode you start each one with `norn run start <unit>`. An attended step always waits for `norn run start`, and then runs in its pane with you. A decision given by typing into the pane is not on norn's record; give it with `norn story answer` too.

`norn run attach <unit>` brings the pane of a unit's live run in front, and `norn run attach --next` the agent that has waited on you longest.

## Keep norn's cockpit in Herdr

`norn status --watch` is the cockpit: what needs you (your turn, an answer, a gate, a stuck unit), then one row per story, the selected row's story beside it, and the keys its row offers in the footer. Each key runs the norn command you would type: `s` is `norn run start`, `a` is `norn story answer`, `y` and `x` are `norn story approve` and `reject`, `u` is `norn run rerun`, `t` is `norn story take`, `g` is `norn run attach`, `enter` shows `norn story view`, and `o` and `i` open the PR and the issue; `?` lists them all. `--pane` opens it in a pane below the one you are in, leaving the focus where it was.

norn's Herdr plugin lives in [`plugins/herdr/`](../plugins/herdr/README.md): the cockpit as a popup (`norn.pick`) or a split (`norn.open`), `norn.next` for `norn run attach --next`, and `norn status --segment` for Herdr's tab bar, which also writes each story's `$norn` sidebar token on its workspace. Its README has the config snippet.

## Share run data with a team

```sh
norn config set store.use refs --commit
```

The `refs` store keeps run data, claims and the mailbox on git refs under `refs/norn/v2/`, pushed to the remote, so every clone sees each story's step and who holds it. Commit the config (`norn init --commit` writes `.agents/norn.yaml`) so the team runs the same tracker, forge, store and plugins; the plugin lock `.agents/norn.plugins.lock` pins the version of each installed plugin beside it.

## Decide from another machine

```sh
# on any clone, while another machine holds gh-12
norn story approve gh-12
norn story answer gh-12 "Keep the old endpoint"
```

`norn story answer`, `approve` and `reject` fetch the remote's run data first, so you decide on where the story stands now. While this machine holds the story's claim, or nobody does, the decision goes on the record here, as on one machine. While another machine holds it, live or expired, the decision is sent to the story's mailbox (`via: mailbox` and the holder in `--json`), and the holder's next tick imports it as the same receipt and applies it; your clone shows the outcome once the holder has published it and your next tick fetches it. Sending it again is a no-op. On the `refs` store the three verbs need the remote, even on the machine holding the story: they fetch first and read the claim there, and while the remote is unreachable they refuse; run them again once it answers. A store with no mailbox that other machines share refuses instead (`claim_held`): run the verb on the holder, or take the story first. `norn story round`, `norn run rerun` and `norn story update-branch` never go through the mailbox: run them on the holder, or take the story.

## Move a story to another machine

```sh
# on the machine that holds it, when you can reach it
norn run stop gh-12             # only if an agent is at work there
git push origin norn/gh-12      # what it built, if its last step did not push it

# on the machine that takes it over
norn story take gh-12 --force --reason "carrying it on at home"
```

`norn story take` moves the story's claim to this machine, and its next tick carries the story on from where the record says it stands. It needs a store both machines read, which is the `refs` store above. A claim nobody holds (`claim.none` in `norn status`, a story released in progress) is taken without `--force`, and one this machine already holds is left as it is. Another holder's claim, live or expired, takes `--force`, since that machine may still be acting on the story. The store compares the claim's version, so when two people take a story at once, one wins and the other is refused with `claim_moved`. The takeover is on the story's record: `norn story view gh-12` lists who took it, from whom, and why. The new holder's worktree starts from the work the old holder last published: every tick of a held story pushes each unit's branch to `refs/norn/heads/` before its run data. On the old machine, an agent that reports after the claim moved is told so (`claim_moved`) and records nothing. Run data a machine wrote and never published before its claim moved is dropped for the remote's record by that machine's next tick (its problems name the ref the dropped part is kept at), and a worktree left there is moved forward to the newest published head when the story comes back. A story this machine holds whose run data diverged from the remote's is held by every tick (`store.diverged`) until `norn story take <key> --force` carries it on the same way; `norn doctor` names it.

The worktree on the new machine is cut from the story branch as the remote has it. Commits the old machine never pushed stay there, so push its branch first when you can.

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
