---
name: norn-fsd
description: Supervise the stories a person names across rounds, from issue to a ready or merged PR — norn-fsd-round for each round, plus recommending the next workflow with its evidence when one ends. Use when a person asks to take named stories through every round to a ready or merged PR. Never a workflow step.
disable-model-invocation: true
---

# Supervise named stories end to end

Load the `norn-fsd-round` skill and follow all of it: main checkout only (stop when `NORN_UNIT` is set or the working directory is a unit worktree), one supervisor per checkout, one foreground subagent per story, norn's commands only, the escalations, the one report. This skill adds only what you, the top-level supervisor, do **between** rounds; the subagents never touch a round's end.

## When a round ends

A subagent returns with its round report when the round ended: every unit of the story has `ended` `done` in `norn story view <story> --json`. If the story is not delivered yet (see When to stop), choose the next workflow and put it to the person.

- **Read what the round left.** Triage and reproduce post their findings as an issue comment (`gh issue view <n> --comments`: the `## Triage` comment, the reproduce comment), and triage's step ends with the outcome it recommends (`refinement`, `quick`, `reproduce`, `fix` or `close`); refinement leaves the Plan section in the spec.
- **Pick the cheapest workflow that delivers safely.** By default it is the one the round recommends; go cheaper only when the evidence says it is safe:
  - triage recommended `refinement`, but the comment shows a one-file docs change with low risk → `quick`;
  - refinement's plan has several seams across packages or a new contract → `story`;
  - the same plan with one seam and no new contract → `quick`;
  - `reproduce` confirmed a cause → `quick`.
- **Starting it is the person's.** Escalate once, with the command that starts it: "gh-203: triage ended; recommended next: `quick`, because the comment shows a one-file docs change with low risk: `norn story round gh-203 --workflow quick`." Run `norn story round` yourself only when the person asked you to start the next round, with `--reason "fsd: <evidence>"`; never on your own judgement, and never with `--force`. When the round has started and the story shows a unit that has not ended, start a new subagent with the same brief.
- **Escalate instead of recommending** when triage ends with `close` ("triage recommends closing gh-204 because …"), when a repo-local workflow the skill does not know would fit (name it as a suggestion), and for a plan that amends the rules file.

## Refinement on the person's behalf

- Refinement as the pack ships it is attended in every step (`attended: true` on refine, clarify and plan in its workflow). Each one is the person's turn: escalate it ("gh-203: refine needs you: `norn run start <unit>`") and wait for the round to move on. Never type into the pane.
- When the repo's refinement runs unattended, answer its asks from the issue, the repo and the comments as `norn-fsd-round` says, and send the rest as one question set. Refinement has no gate: the person starting the next round is the plan's approval, so recommend that round with the plan's evidence, unless a rules change or an open spec question needs the person first.

## When to stop

A story is delivered when its `story`, `quick` or `fix` round has its `ready` `approve` (and is merged, when the request named the merge), or when the person ends supervision. Then give the `norn-fsd-round` report, adding each round's workflow and the reason it was recommended.
