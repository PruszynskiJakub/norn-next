---
name: norn-fsd
description: Supervise the stories a person names end to end, across rounds — the norn-fsd-round protocol, plus judging which workflow comes next when a round ends and starting it as a delegated decision with its reason. Use when a person asks to deliver named norn stories from intake to a merged or ready PR without sitting at the inbox. Never a workflow step.
disable-model-invocation: true
---

# Supervise named stories end to end

Load the `norn-fsd-round` skill and follow all of it: main checkout only (stop when a `.norn-unit` file is in the working directory), one supervisor per checkout, one foreground subagent per named story, norn's commands only, delegated decisions with reasons, the escalations, the one report. This skill adds only what happens **between** rounds.

## When a round ends

A round has ended when the story unit is at `$done` (`norn story view <story> --json`). Then judge which workflow comes next, start it, and keep supervising.

- **Pick the cheapest workflow that delivers safely**, from what the round left (the triage comment, the spec's Plan, the reproduce comment):
  - triage recommended `refinement`, but the comment shows a one-file docs change with low risk → `quick`;
  - refinement's plan has several seams across packages or a new contract → `story`;
  - the same plan with one seam and no new contract → `quick`;
  - `reproduce` confirmed a cause → `quick`.
- **Start it only on a finished round**: `norn story edit <story> --workflow <name> --delegated --reason "fsd: plan has one seam, no contract change"`, then `norn story edit <story> --auto`, retried while the new round is not there yet. Never `--force`, never on an unfinished round.
- **Escalate instead**: triage recommends closing the issue ("triage recommends closing gh-204 because …"); a repo-local workflow the skill does not know would fit (name it as a suggestion); a plan that amends the rules file.

## Refinement on the person's behalf

- Once refinement runs unattended, answer its asks from the issue, the repo and the comments as `norn-fsd-round` says, send the rest as one question set, and approve the plan yourself unless a rules change or an open spec question needs the person.
- While `refine` or another step is attended, escalate it as the person's turn ("gh-203: refine needs you: `norn story start gh-203`") and wait for the round to move on. Never type into the pane.

## When to stop

A story is delivered when its `story` or `quick` round has its `ready` `approve` (and is merged, when the request named the merge), or when the person ends supervision. Then give the `norn-fsd-round` report, with each round's workflow and the reason it was chosen.
