# Recipes

What to do when something happens. Each recipe names the inbox item you see in `norn status` and the command that resolves it; the [cockpit](../plugins/herdr/README.md#the-cockpit) (`norn status --watch`) runs the same commands by key. Terms are explained in [Concepts](concepts.md), every flag in [Reference](reference.md).

## An agent asked a question

**You see:** an Answer item with the agent's question and `norn story answer <unit> "…"`.

```sh
norn story answer gh-18/02 "Keep the old endpoint and mark it deprecated in the docs"
```

The next tick types your answer into the same session, or starts a fresh session on the step's handoff when the agent is gone. If the answer needs a conversation, open the agent's pane (`norn run attach gh-18/02`), but give the decision through `norn story answer` too, or norn has no record of it.

## A permission prompt blocks an agent

**You see:** an Answer item that quotes a prompt with numbered options.

```sh
norn story answer gh-18/02 "1"
```

norn types the key the prompt expects. If the prompt went away and came back with a new id, the first answer is refused: run `norn status` again and answer the new item.

## A gate waits for you

**You see:** an Approve item with the gate's instruction, for example to review the slice files or the PR.

```sh
norn story approve gh-17
norn story reject gh-17 --reason "Split slice 02: the migration and the endpoint are separate"
```

A rejection sends the unit back with your reason in the next attempt's brief, counted by the route's counter. At `human-qa`, the item lists each criterion QA left to you and how to check it: approving records that you checked it.

## An agent died, hung or ran out of retries

norn handles most of this itself: an agent that dies is classified `died` and retried, one that goes quiet is nudged, one past its deadline is stopped. You only see it when the retries run out.

**You see:** an Unblock item with the reason (`died`, `stalled`, `timeout`, a counter at its max) and `norn run rerun <unit>`.

1. Read what happened: `norn run list gh-18/02` shows the step timeline, `norn run view gh-18/02 --why` the decision and the rule behind it.
2. Fix the cause if it is outside the agent (a broken test command, a missing tool).
3. Resume it in a fresh session:

```sh
norn run rerun gh-18/02
norn run rerun gh-18/02 --step implement --reset test_loop --reason "test command fixed"
```

To stop an agent that is still running, `norn run cancel gh-18/02`; the work stays, and `norn run rerun` resumes it.

A check that failed on a glitch (a CI hiccup, machine load, a flaky test) sends the unit back to implement, where an agent starts at once. To run the check again on the same code, `norn run rerun gh-18/02 --step test`: it is accepted while the unit is at the step that check's fail sent it to, and the next tick stops that step's agent. `norn run view gh-18/02 --json` tells you first: its `check_retry` names the check, the rerun, and `code_changed`, whether any commit or uncommitted change since the fail touched more than the spec's `handoffs/`.

## An agent is stuck

**You see:** an Unblock item with the agent's own reason from `norn stuck`.

Do what the reason asks (grant access, fix the environment, settle a contradiction in the spec, ideally in the spec file itself), then `norn run rerun <unit>`. If the step should go somewhere else, add `--step <step>`.

## `norn status` keeps asking you to start the same step

**You see:** a manual step stays "ready: start an agent", and each agent you start runs `norn brief` and ends at once, refused with `already_reported`.

No heartbeat runs on this checkout, so the agent's `norn brief` and `norn done` wait for a tick that never comes. Run `norn tick` once to apply them, then keep `norn watch` running (or a cron tick, below) while you work. `norn status` shows the step as waiting for the heartbeat, with an Unblock item that names `norn watch`, whenever receipts wait for a tick and no heartbeat runs.

## The base moved under a story

norn merges the base into the story branch in an `update` step, never by rebasing. When the merge conflicts, a `resolve` step has an agent resolve it, and the story goes on.

Two kinds of conflict need no agent. When every conflicting path is a generated file the team's `regenerate` key maps (see [Reference: Config](reference.md#config)), norn takes the base's version of each, runs the mapped commands, and commits the merge with a `Norn-Regenerated` trailer; the story then goes through its test step as after any merge. A command that fails or times out, or a path still conflicted after the commands ran, aborts the merge and goes to `resolve`, with what the commands printed in the resolver's brief. A story branch that holds nothing but its own spec folder (a story waiting in triage or refinement) takes the base's version of every conflicting file outside that folder, with no key needed; it is still a merge. On the light path, a regenerated merge counts as clean when everything it changed over git's own merge is a mapped file.

A story waiting at a gate or a `merge` step with a `stale` route goes back through update by itself. In the shipped `story` and `quick` workflows a story past the `ready` gate waits at the `merge` step until you merge its PR, so a conflicting base move while the PR waits needs nothing from you. When git merged the base by itself (a clean merge) and test and CI then pass, your earlier `ready` approval carries over: norn gives the `approve` and History shows `approval carried: clean base merge`. When a merge needed a resolution, you approve `ready` again; its item, the brief and the PR body list one `git show --remerge-diff <sha>` per merge, which shows only what the resolver changed. When the story has a PR, norn first waits for the next sync to fetch it: if the base moved because that PR merged, the story ends through the merge path and no second PR is opened.

A base move without a conflict can still break the story: a rename on the base that the story's new code still calls. With `base.verify: <check step>` in the workflow, set to `test` in the shipped `story` and `quick`, norn runs that check on the merge of the base into the story head when the base moves under a story waiting at `ready` or `merge` without a conflict. It runs once per base move, detached in a temporary worktree like any check step and taking a check slot, and it pushes nothing, starts no CI and asks no approval. Green leaves the story waiting. Red sends it back, from whichever of `ready` or `merge` it waits at when the run ends (a person may approve `ready` while it runs), through update by the waiting step's `stale` route and counter, with the failing output as the next step's `last_check`. A workflow without `base.verify` verifies nothing, and one with `base.stale: behind` cannot set it: there every base move goes through update already.

**You see:** a Check item such as `gh-3 conflicts with main in a.ts, b.ts (4 behind)` when the story waits at a gate without a `stale` route, is stuck, or is done with its PR not merged yet (a workflow without a `merge` step).

```sh
norn story update-branch gh-3
```

The story goes back through its update step; you approve the `ready` gate again afterwards, since the head changed. A finished story with a conflicting PR is updated this way, never with a new round: `norn story edit gh-3 --workflow <the workflow its round ran>` is refused there and names `norn story update-branch gh-3`. Starting a new round, with another workflow or `--at <step>`, is for new work. You may also push to the story branch yourself at any time: norn merges your push in and never loses it.

## The base refused a merged story's done record

Once a story PR merges, norn marks the story's `spec.md` `status: done` on the base branch. It pushes fast-forward only and never forces the push. A fetch that fails or a push that hits the network only waits for the next try, about every 5 minutes with the sync. If the base refuses the record 3 times (a protected branch, a spec that will not patch), norn stops retrying.

**You see:** an Unblock item such as `gh-3 merged, but main refused its status: done record 3 times`, with the last refusal in its detail.

Set `status: done` in the story's `spec.md` on the base yourself and commit it, by a PR if the branch is protected. The item clears once norn sees the base read done, within one sync under `watch` or right away with `norn sync`. If the story's spec is gone from the base, `norn tidy` drops the record.

## Write your own workflow

1. Copy one of the workflows in `.agents/workflows/` under a new name, for example `docs.yaml`, and change its `name:`.
2. Edit the steps. Each opens with one head key that says what happens (`agent:`, `check:`, `gate:` or a verb with no value such as `open-pr:`), then says where each outcome goes in `outcomes:`. A route back needs a counter. An agent step's head is its orientation, what the step is for; `skills:` (optional) lists the skills it uses, `by:` picks a configured agent, and `means:` says what each routed outcome means (with `verdict:` beside it when the outcome judges the criteria):

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
    outcomes: { pass: review, fail: { to: implement, counter: test_loop } }
  ready:
    gate: Read the draft PR. Approve to wait for the merge, or reject with what to change.
    outcomes: { approve: merge, reject: { to: implement, counter: ready_loop } }
```

   norn refuses at load a step with two head keys or none, a verb given a value (`open-pr: now`), an agent step with no orientation, a skill listed twice, a routed outcome with no meaning, a meaning or verdict for an outcome the step does not route, and `means:` or `verdict:` on a step that is not an agent step.

   An agent step whose outcome sends work back can require what comes with it: `hand_back: { changes_requested: findings }` makes `norn done changes_requested` refuse a report without `--findings <file>` (code `hand_back_required`), and `evidence` requires `--evidence <dir>`; the brief's finish line shows the flag. norn refuses at load a `hand_back` key the step does not route, or one that is an overridable route. The shipped workflows require findings on `review.changes_requested`, `resolution-review.changes_requested` and `qa.fail`.

   A file in the old wording (`type: agent` with `skill:` and `instructions:`, `type: check` with `run:`, `type: gate` with `prompt:`, `type: git` with `action:`, `means`/`verdict` inside a route) is refused in the main checkout. Run `norn upgrade`: it rewrites each such file in place, keeping its comments and layout. A story already in flight keeps running on its pinned workflow.

   An `await-merge:` step after the last gate keeps a story past that gate in its workflow until its PR merges: `merge: { await-merge: null, outcomes: { stale: { to: update, counter: stale_loop } } }`. Its one outcome is `stale`; the merge itself ends the story.

   Once `open-pr` has run, every route from a step that changes code (an agent step or `update-branch:`) to a gate or merge step the round can end from must pass `open-pr` again: then the PR head a person merges is the commit CI checked. norn refuses a workflow that skips it and names the path. At run time, a story waiting at such a gate or merge step whose local head changes a path outside its spec folder that the PR lacks goes back to `open-pr` on its own. Changes inside the spec folder stay local.

   A check ends in `pass` (exit 0) or `fail` (any other exit). One that can end another way names the outcome per exit code in `exits` and routes it like any other: the shipped `ci` check exits 3 on a PR that conflicts with its base, and `exits: { 3: stale }` with `stale: { to: update, counter: stale_loop }` sends the story to take the base instead of to `implement`.

3. Write a step once and reuse it, when the same steps appear in several workflows or a step differs from another only in its routes (below).
4. Commit it. norn validates a workflow before a unit uses it and refuses one that does not hold together, naming what is wrong.
5. Run `norn upgrade` once: it creates the `norn:wf:docs` label on the remote. Then use it: label an issue `norn:wf:docs`, or start the next round of a story with `norn story edit gh-12 --workflow docs`.

A unit pins its workflow when it starts, with every `use` and `like` already filled in, so your edit, to a shared file too, applies to rounds that start after it.

### Share steps between workflows

Steps that several workflows run the same way (the CI wait, the base update, opening the PR) go in a shared file, `.agents/workflows/shared/<name>.yaml`. It holds `start` (its first step), `steps` and an optional `description`, and nothing else. A shared file is never a workflow: it is not listed, gets no label and cannot be started.

A route inside a shared file names one of the file's own steps, `$done` or `$stuck`, or leaves the file through a named exit, `{ exit: <name> }`; the file's named exits are the names its routes give. A named exit is not a check's `exits`, which turns an exit code into an outcome: below, the `ci` check's `exits: { 3: stale }` makes exit code 3 the outcome `stale`, and the route for `stale` leaves the shared file through its named exit `behind`.

```yaml
# .agents/workflows/shared/ship.yaml
description: Open or update the PR, then wait for its CI.
start: open-pr
steps:
  open-pr:
    open-pr:
    outcomes: { done: ci }
  ci:
    check: ./scripts/wait-for-ci.sh
    timeout: 30m
    exits: { 3: stale }
    outcomes:
      pass:  { exit: green }
      fail:  { exit: red }
      stale: { exit: behind }
```

A workflow brings the file in with a step that holds only `use: <name>` and the routes for the file's named exits. The `use` step routes each named exit like an outcome, counters included:

```yaml
  describe:
    agent: Write the PR body to pr.md in the spec folder.
    skills: [norn-pr]
    outcomes: { done: ship }
    means: { done: "pr.md describes the branch as it is now" }
  ship:
    use: ship
    outcomes:
      green:  ready
      red:    { to: implement, counter: ci_loop }
      behind: { to: update, counter: stale_loop }
```

The shared steps keep their own names, so the brief, receipts, history and `--at` show `open-pr` and `ci`, never `ship`. A route, `start` or `base.step` that names the `use` step enters the file at its `start`; any route, `base.step` or `base.verify` can name an included step to enter the file in the middle. A named exit the `use` step does not route goes to `$stuck`. A route inside the shared file can name a counter the workflow declares, and the workflow's `defaults:` apply to the included steps as to its own.

### Copy a step with `like:`

A step written `like: <step>` copies that step of the same file and replaces each key it writes, whole. It works in a workflow and in a shared file alike:

```yaml
  test:
    check: npm ci && npm test
    timeout: 15m
    outcomes: { pass: qa, fail: { to: implement, counter: test_loop } }
  test-merge:
    like: test
    outcomes: { pass: open-pr, fail: { to: implement, counter: test_loop } }
```

`test-merge` runs the same command with the same timeout; only its `outcomes` differ. A key is replaced whole, never merged: `test-merge` above writes both of its routes. A copy inherits its target's head key and may not write another one (that is two head keys). The same holds for `means:` and `verdict:`: a copy that writes `means:` replaces the whole map, so it must give a meaning for every outcome it routes, inherited ones included, or it is refused.

### What norn refuses

norn refuses the workflow when it loads, naming the file and the step, and shows it as broken wherever a broken workflow shows (`norn doctor`, the workflow listing, `norn story create`, `norn story edit --workflow`):

- a `use:` naming a shared file that does not exist: the message names the file and the folder it looked in, `.agents/workflows/shared/`;
- an included step with the same name as a workflow step, a step of another shared file or the `use` step itself, and a shared file used twice in one workflow: the message names the step and both places it comes from;
- a `use` step routing a named exit the shared file does not have, a misspelt one included: the message names it and lists the file's named exits;
- a `use:` inside a shared file: a shared file cannot use another shared file;
- `name`, `counters`, `defaults`, `mode` or `base` in a shared file: that key belongs in the workflow;
- a route in a shared file naming a step outside it: a shared file leaves through a named exit (`{ exit: <name> }`);
- `reset_on` or `base.verify` naming a `use` step: name the included step instead;
- a `like:` naming a step that does not exist, the step itself, another `like` step, a `use` step or a step of another file, and a `use` step that carries `like`.

An included step that breaks an ordinary rule (an unknown counter, a route back without a counter) is refused with a message that names its shared file and the step in it.

## Name your own skill in a step

Write the skill under a name without the `norn-` prefix in `.agents/skills/<name>/SKILL.md`, link it into each agent's skill folder, and list it in the step: `skills: [my-review]`. A step may list several (`skills: [my-review, norn-tdd]`); the brief then says "Use the `my-review` and `norn-tdd` skills." above the step's orientation. A step with no `skills:` gets only its orientation. A skill that is not installed, or not visible to the agent `by:` picks, is refused at load (`unknown_skill`), and `norn doctor` reports it.

## Hand a story over

On your machine, when you stop working on the story:

```sh
norn story handoff gh-12
```

It pushes the branches (with the handoffs on them), then the story's record to `refs/norn/runs/gh-12`, and only then releases the claim; it names the record commit and the story branch commit it matches. If the record push fails, nothing is released: check the remote and run it again. A clean `norn watch` exit and `norn story close` push the record the same way before they release a claim. While a resolve step waits at a question with its base merge in progress, the unfinished merge lives only in your worktree and cannot be pushed: `norn story handoff` refuses the story (`merge_in_progress`) until the question is answered and the merge concluded, and a clean `norn watch` exit keeps that story's claim, so a restart on the same machine resumes the merge. On the colleague's machine:

```sh
norn story checkout gh-12
```

It claims the story, checks out its branches, fetches the record into their machine dir and prints the status and the handoff, and their heartbeat drives it from there at the same step, attempt and counters. Commits pushed on top of the branch after the record are fine. If the branch was rewritten since the record (the commit it matches is gone), the record is kept and the current step restarts as a new attempt, with the reason in the brief.

If your machine is gone and still holds the claim, wait for the claim to expire or run `norn story checkout gh-12 --force`; the takeover is recorded. Under the `local` record policy your machine pushed the record only when it released a claim and each time `open-pr` opened or updated the PR, so what happened after the last such push is lost: when the ref holds an older record, checkout resumes from that one. When the ref holds none (the story never released a claim and never reached `open-pr`), checkout says the record was lost and starts a new round of the story's workflow, pinned from the branch, at the step its last boundary commit led to, with fresh counters; the brief tells the agent to check the branch for what is already done. Under the `remote` policy (`norn config set record.policy remote --repo`) the record is pushed whenever it changes, so a takeover finds it as of the last tick that pushed it. The same `--force` checkout recovers a story on your own machine after its `~/.norn` was wiped.

When your machine comes back after a takeover without a release, its next tick sets its copy of the record aside as superseded (`~/.norn/repos/<id>/superseded/`), never pushes it, and shows one Check item; `norn tidy` deletes it after `trace.retain`. After a clean `norn story handoff` your copy is already on the ref and is removed quietly.

## Keep the heartbeat alive without a terminal

Run a tick from cron every minute in the repository:

```sh
* * * * * cd /path/to/repo && /usr/local/bin/norn tick --interval 1m >> /tmp/norn-tick.log 2>&1
```

`--interval` tells norn how often the tick runs: it is recorded for the checkout and sets when the heartbeat counts as down and how long a claim lasts. Match it to the cron schedule; without it, norn assumes 30 seconds. Every tick on one checkout shares one heartbeat id, so each recognises the claim the previous one renewed. cron has a minimal `PATH`: give full paths to `norn`, `gh` and your agent, or set `PATH` in the crontab.

## Explain a slow tick

`norn story list` and the cockpit header show how long the last tick took. Each tick's record in the trace (one JSON line per tick in the day file `~/.norn/repos/<id>/<day>.jsonl`) says where it spent its time. Its `tick.end` line names the slowest phase, so a slow tick is one `jq` away:

```sh
jq -c 'select(.type == "tick.end" and .duration_ms > 8000) | {tick_id, duration_ms, slowest}' ~/.norn/repos/<id>/<day>.jsonl
```

The full `tick` record with that `tick_id` holds the rest. `sync` says whether a remote sync ran and how it ended. `timing` gives `observe_ms`, `decide_ms`, `act_ms` and `after_ms`, observe's phases in `timing.observe` (`base_fetch`, `local`, `sync.norn_refs`, `sync.issues`, `sync.stories`, `runner`, `stories`, …), and the remote calls the sync made in `timing.calls`. Process liveness probes have no phase of their own: they count under `local` (the claims' leases) and `stories` (each story's sessions). `act_ms` includes writing the `tick.start` line. Each decision's `result.ms` is the time its action took; claim renewals are pushed in one batch, so each one shows the batch's time, and `slowest` names the batch once (`act claim renew (N claims)`). Older records have none of these fields.

## Roll out a new norn to a team

The repo's norn version (`norn_version` in `.agents/norn.config.yaml`, see [Concepts](concepts.md#the-repos-norn-version)) says which norn every machine runs. Moving it is one commit by one person; everyone else pulls and installs. `norn upgrade` moves a repo from norn 0.30 on: a repo that records no `norn_version`, or one below 0.30, is refused (`version_missing`, `version_too_old`) with the path forward: install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with the new norn (and `norn init` first if norn was never set up there).

**The person who upgrades**, in the main checkout:

1. Install the new norn ([README: Install](../README.md#install)) and check it with `norn --version`.
2. Stop `norn watch` (and any cron tick) on this checkout: `norn upgrade` refuses while a tick runs.
3. Run `norn upgrade`. It rewrites each workflow and shared file in `.agents/workflows/` still in the old wording to the new one, keeping its comments and layout; a file holding a comment the rewrite cannot place is left as written and listed with its line, for you to edit by hand, and the rest still move. It rewrites the bundled `norn*` skills in `.agents/skills/` to its copies and relinks them into each configured agent's skill folder, then moves `norn_version` to the running binary's version, last, so a run cut short leaves the old version and a rerun finishes it. Everything is staged and nothing committed; it ends with the commit to make, which names the new version (or says only the skills were refreshed). It also creates any label norn uses that is missing on the remote, and a remote it cannot reach is reported without failing the upgrade. With nothing to do it prints `already on norn <version>: nothing to upgrade` and stages nothing.
4. Review `git diff --staged`, commit it and push it to the base branch (through a PR if your base branch takes only PRs).

`norn upgrade` never moves the version backward: a binary older than the repo's version is refused with the norn to install. To really go back, edit the key in the team file by hand, where review sees it.

**Teammates**, once the commit is on the base branch: pull it into the main checkout, install the same minor (any patch at or after the recorded one), and restart `norn watch`. Until they install, the commands that act refuse with `this repo needs norn X.Y.x (you run …)` and the norn to install; `norn status` shows the same at the top. A `norn watch` started before the pull keeps running: it skips each tick it may not run, sends one notification ("ticks paused"), and resumes by itself once the version matches again. A tick run from cron exits 3 each time instead.

**`norn init` is for a new repo or a new machine**, never for moving the version. On a repo with no team file it records the running norn's version; a team file with no `norn_version`, or one below 0.30, is an older norn's repo and init refuses it (`version_missing`, `version_too_old`) with the 0.30 path, writing nothing. On a repo from 0.30 on it sets up your machine and leaves `norn_version` and the bundled skills alone; when they differ from your binary it says so and points at `norn upgrade`. A missing bundled skill is copied in either way.

**Units in flight** wait for their branch to take in the base. A story branch cut before the upgrade still holds the old skills, so after you install the new norn its next agent step is held as drift (the inbox names `norn story update-branch <story>`) until the next base sync, or that command, brings the new skills in; then it launches. Its pinned workflow does not change. A claim held by a machine that is now refused is not handed over: it expires as when a machine stops ticking, and a matching machine takes it over.

**A norn from before this check** does not know the key: on a repo that records a `norn_version` it refuses every command with a config error, `` unknown key `norn_version` ``, exit code 6 (`config`), and writes nothing. The fix is the same: install the norn the repo records.

**Check it in CI.** `norn doctor --repo` checks the repo's norn version against the installed norn, the bundled skills against its copies, and the workflows and config, with no agent, runner or remote. Installing the latest release makes a PR red when the repo is behind it or when someone hand-edited a bundled skill:

```yaml
  norn:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install the latest norn
        run: |
          curl -fsSLO https://github.com/PruszynskiJakub/norn-next/releases/latest/download/norn-linux-x64
          sudo install -m 755 norn-linux-x64 /usr/local/bin/norn
      - run: norn doctor --repo
```

To check only the skills, workflows and config, and not lag behind the latest release, install the version the repo records instead: `releases/download/v$(sed -n 's/^norn_version: *//p' .agents/norn.config.yaml)/norn-linux-x64`.
