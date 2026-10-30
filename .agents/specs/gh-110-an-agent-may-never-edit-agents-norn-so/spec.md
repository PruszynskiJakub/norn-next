---
id: gh-110
slug: an-agent-may-never-edit-agents-norn-so
provider: gh
number: 110
url: https://github.com/PruszynskiJakub/norn-next/issues/110
title: An agent may never edit .agents/norn/, so workflow and config changes have no route through norn
assignee: PruszynskiJakub
labels:
  - friction
  - norn
workflow: triage
status: new
intake_at: 2026-10-30T11:26:29.364Z
body_hash: 4c5fb9642bcee931dfe7a0fa7635b5ad8d52d2d134efa2efc277162ca2a20b49
---

## Observed

The norn skill's hard rules say: "Never edit anything under `runs/`, the generated top of handoff.md, or files in `.agents/norn/`." In this repo `.agents/norn/` holds the repo workflows (`workflows/*.yaml`) and `config.yaml`. A story whose change touches them (e.g. the CLI regroup renaming commands used in workflow steps) cannot make that change inside a norn step. The agent either commits to the story branch from outside a step, against AGENTS.md's hard rule, or asks.

Seen in an agent handoff: "I committed to the story branch from outside a norn step because you asked … An agent may never edit .agents/norn/, so renaming commands in workflow files has no route through norn."

Upcoming stories need this route too: #71's follow-up "Triage as a single round" (`triage.yaml`), #96 (drop `describe` from `quick`/`story`/`release`), #64 (config).

The rule is broader than its reason. Under S7 a running round uses its own pinned copy of the workflow (`runs/<unit>/workflow.yaml`), so editing a repo workflow does not change the unit that is running. What an agent must not touch is `runs/`, the machine-local `trace/` (gitignored) and the generated top of handoff.md.

## Wanted

- Narrow the hard rule to `runs/`, `.agents/norn/trace/` and the generated top of handoff.md.
- An agent may edit `.agents/norn/workflows/` and `.agents/norn/config.yaml` as ordinary repo files in a step, checked by the review step and by workflow validation (W1, W5).
- Edit the bundled source in `packages/cli/assets/skills/norn/`, then re-sync the copy in `.agents/skills/norn/`.

## Where

- `packages/cli/assets/skills/norn/SKILL.md:67` (copy: `.agents/skills/norn/SKILL.md:67`)
- `packages/cli/src/runtime/workflows.ts:2` (repo workflows parsed and validated for decide)
- `AGENTS.md` Process: hard rule on changing the repo only inside a norn step

## PRD

S7 (workflows pinned per round), W1, W5 (workflow validation), G6 (workflows are data, editable per repository).
