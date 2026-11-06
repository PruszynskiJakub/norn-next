---
name: norn-fsd
description: Supervise the stories a person names across rounds, from issue to a ready or merged PR — norn-fsd-round for each round, plus choosing and starting the next workflow as a delegated decision when one ends. Never a workflow step.
disable-model-invocation: true
---

# Supervise named stories end to end

Load the `norn-fsd-round` skill and follow all of it: main checkout only (stop when a `.norn-unit` file is in the working directory), one supervisor per checkout, one foreground subagent per story, norn's commands only, the escalations, the one report. This skill adds only what you, the top-level supervisor, do **between** rounds; the subagents never start a round.

## When a round ends

A subagent returns with its round report when the round ended: `unit.status` is `done` in `norn story view <story> --json`. If the story is not delivered yet (see When to stop), choose the next workflow, start it, and start a new subagent with the same brief.

- **Read what the round left.** Triage and reproduce post their findings as an issue comment (`gh issue view <n> --comments`: the `## Triage` comment, the reproduce comment); refinement leaves the Plan section in the spec (`spec` in the story view's JSON).
- **Pick the cheapest workflow that delivers safely.** By default it is the one the round recommends; go cheaper only when the evidence says it is safe:
  - triage recommended `refinement`, but the comment shows a one-file docs change with low risk → `quick`;
  - refinement's plan has several seams across packages or a new contract → `story`;
  - the same plan with one seam and no new contract → `quick`;
  - `reproduce` confirmed a cause → `quick`.
- **Start it only on a finished round**: `norn story edit <story> --workflow <name> --delegated --reason "fsd: plan has one seam, no contract change"`, then `norn story edit <story> --auto`. The new round exists only after the next tick: until then `--auto` is refused because the story still shows done; retry it until it is accepted and `unit.round` has gone up. A `round_unfinished` refusal means the round has not ended. Never `--force`, never on an unfinished round.
- **Escalate instead**: triage recommends closing the issue ("triage recommends closing gh-204 because …"); a repo-local workflow the skill does not know would fit (name it as a suggestion); a plan that amends the rules file.

## Refinement on the person's behalf

- Refinement as `norn init` ships it is attended in every step (`attended: true` on refine, clarify and plan in its workflow). Each one is the person's turn: escalate it ("gh-203: refine needs you: `norn story start gh-203`") and wait for the round to move on. Never type into the pane.
- When the repo's refinement runs unattended, answer its asks from the issue, the repo and the comments as `norn-fsd-round` says, and send the rest as one question set. Refinement has no gate: starting the next round is the plan's approval, so approve the plan yourself by starting it, unless a rules change or an open spec question needs the person.

## When to stop

A story is delivered when its `story` or `quick` round has its `ready` `approve` (and is merged, when the request named the merge), or when the person ends supervision. Then give the `norn-fsd-round` report, adding each round's workflow and the reason it was chosen.
