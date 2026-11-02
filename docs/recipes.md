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
4. Use it: label an issue `norn:wf:docs`, or start the next round of a story with `norn story edit gh-12 --workflow docs`.

A unit pins its workflow when it starts, so your edit applies to rounds that start after it.

## Hand a story over

On your machine, when you stop working on the story:

```sh
norn story handoff gh-12
```

It pushes the branches and the handoff and releases the claim. On the colleague's machine:

```sh
norn story checkout gh-12
```

It claims the story, checks out its branches and prints the handoff, and their heartbeat drives it from there. If your machine is gone and still holds the claim, `norn story checkout gh-12 --force` takes it over; the takeover is recorded.

## Keep the heartbeat alive without a terminal

Run a tick from cron every minute in the repository:

```sh
* * * * * cd /path/to/repo && /usr/local/bin/norn tick >> /tmp/norn-tick.log 2>&1
```

Every tick on one checkout shares one heartbeat id, so each recognises the claim the previous one renewed. cron has a minimal `PATH`: give full paths to `norn`, `gh` and your agent, or set `PATH` in the crontab.
