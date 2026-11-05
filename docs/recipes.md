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

## An agent is stuck

**You see:** an Unblock item with the agent's own reason from `norn stuck`.

Do what the reason asks (grant access, fix the environment, settle a contradiction in the spec, ideally in the spec file itself), then `norn run rerun <unit>`. If the step should go somewhere else, add `--step <step>`.

## The base moved under a story

norn merges the base into the story branch in an `update` step, never by rebasing. When the merge conflicts, a `resolve` step has an agent resolve it, and the story goes on.

**You see:** a Check item such as `gh-3 conflicts with main in a.ts, b.ts (4 behind)` when the story waits at a gate, is stuck or is done with its PR not merged yet.

```sh
norn story update-branch gh-3
```

The story goes back through its update step; you approve the `ready` gate again afterwards, since the head changed. You may also push to the story branch yourself at any time: norn merges your push in and never loses it.

## Write your own workflow

1. Copy one of the workflows in `.agents/workflows/` under a new name, for example `docs.yaml`, and change its `name:`.
2. Edit the steps: each names its type, its skill or command, and where each outcome goes. A route back needs a counter.

```yaml
  test:
    type: check
    run: npm ci && npm test
    timeout: 15m
    outcomes: { pass: review, fail: { to: implement, counter: test_loop } }
```

3. Commit it. norn validates a workflow before a unit uses it and refuses one that does not hold together, naming what is wrong.
4. Run `norn upgrade` once: it creates the `norn:wf:docs` label on the remote. Then use it: label an issue `norn:wf:docs`, or start the next round of a story with `norn story edit gh-12 --workflow docs`.

A unit pins its workflow when it starts, so your edit applies to rounds that start after it.

## Hand a story over

On your machine, when you stop working on the story:

```sh
norn story handoff gh-12
```

It pushes the branches (with the handoffs on them), then the story's record to `refs/norn/runs/gh-12`, and only then releases the claim; it names the record commit and the story branch commit it matches. If the record push fails, nothing is released: check the remote and run it again. A clean `norn watch` exit and `norn story close` push the record the same way before they release a claim. On the colleague's machine:

```sh
norn story checkout gh-12
```

It claims the story, checks out its branches, fetches the record into their machine dir and prints the status and the handoff, and their heartbeat drives it from there at the same step, attempt and counters. Commits pushed on top of the branch after the record are fine. If the branch was rewritten since the record (the commit it matches is gone), the record is kept and the current step restarts as a new attempt, with the reason in the brief.

If your machine is gone and still holds the claim, wait for the claim to expire or run `norn story checkout gh-12 --force`; the takeover is recorded. Without a record on the ref (your team uses the `local` record policy and your machine never released the claim), checkout says the record was lost and starts a new round of the story's workflow, pinned from the branch, at the step its last boundary commit led to, with fresh counters; the brief tells the agent to check the branch for what is already done. Under the `remote` policy (`norn config set record.policy remote --repo`) the record is on the ref after every boundary, so nothing is lost. The same `--force` checkout recovers a story on your own machine after its `~/.norn` was wiped.

When your machine comes back after a takeover without a release, its next tick sets its copy of the record aside as superseded (`~/.norn/repos/<id>/superseded/`), never pushes it, and shows one Check item; `norn tidy` deletes it after `trace.retain`. After a clean `norn story handoff` your copy is already on the ref and is removed quietly.

## Keep the heartbeat alive without a terminal

Run a tick from cron every minute in the repository:

```sh
* * * * * cd /path/to/repo && /usr/local/bin/norn tick --interval 1m >> /tmp/norn-tick.log 2>&1
```

`--interval` tells norn how often the tick runs: it is recorded for the checkout and sets when the heartbeat counts as down and how long a claim lasts. Match it to the cron schedule; without it, norn assumes 30 seconds. Every tick on one checkout shares one heartbeat id, so each recognises the claim the previous one renewed. cron has a minimal `PATH`: give full paths to `norn`, `gh` and your agent, or set `PATH` in the crontab.

## Roll out a new norn to a team

The repo's norn version (`norn_version` in `.agents/norn.config.yaml`, see [Concepts](concepts.md#the-repos-norn-version)) says which norn every machine runs. Moving it is one commit by one person; everyone else pulls and installs.

**The person who upgrades**, in the main checkout:

1. Install the new norn ([README: Install](../README.md#install)) and check it with `norn --version`.
2. Stop `norn watch` (and any cron tick) on this checkout: `norn upgrade` refuses while a tick runs.
3. Run `norn upgrade`. It moves `norn_version` to the running binary's version, rewrites the bundled `norn*` skills in `.agents/skills/` to its copies, and makes any layout or config move the new version needs, all staged and nothing committed. Run state an older norn committed to the base branch (each spec folder's `runs/`) is packed into one `refs/norn/runs/<story>` per finished story and pushed; only a story whose ref is on the remote gets its removal staged, along with norn's `runs/**` line in `.gitattributes`. A story whose push fails keeps its run state and is named with the reason; a rerun pushes only the refs still missing. Until that removal is committed, `norn status` and `norn doctor` point to `norn upgrade`. It prints what moved; with nothing to move it says so and changes nothing.
4. Review `git diff --staged`, commit it and push it to the base branch (through a PR if your base branch takes only PRs).

`norn upgrade` never moves the version backward: a binary older than the repo's version is refused with the norn to install. To really go back, edit the key in the team file by hand, where review sees it. `norn migrate` is the old name of `norn upgrade` and still works, with a one-line notice, until the next minor.

**Teammates**, once the commit is on the base branch: pull it into the main checkout, install the same minor (any patch at or after the recorded one), and restart `norn watch`. Until they install, the commands that act refuse with `this repo needs norn X.Y.x (you run …)` and the norn to install; `norn status` shows the same at the top. A `norn watch` started before the pull keeps running: it skips each tick it may not run, sends one notification ("ticks paused"), and resumes by itself once the version matches again. A tick run from cron exits 3 each time instead.

**`norn init` is for a new repo or a new machine**, never for moving the version. On a repo without the key it records the running norn's version. On a repo that has one it sets up your machine and leaves `norn_version` and the bundled skills alone; when they differ from your binary it says so and points at `norn upgrade`. A missing bundled skill is copied in either way.

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
