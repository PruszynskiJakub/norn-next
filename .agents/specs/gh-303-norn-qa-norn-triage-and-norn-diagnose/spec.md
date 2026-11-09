---
id: gh-303
slug: norn-qa-norn-triage-and-norn-diagnose
provider: gh
number: 303
url: https://github.com/PruszynskiJakub/norn-next/issues/303
title: norn-qa, norn-triage and norn-diagnose use subagents where they pay off
assignee: PruszynskiJakub
labels:
  - norn
workflow: quick
status: active
intake_at: 2026-11-09T11:32:10.430Z
body_hash: 53f954b3a159c98e1961440eb9a2bbd7535d8a2c789f5e075439eeb98eed2e3c
---

## Observed

`norn-review` uses subagents (one per axis, and a fresh one to check each blocking finding), and so does `DESIGN-IT-TWICE.md` (one per design). `norn-qa`, `norn-triage` and `norn-diagnose` do all their work in one context. So:
- QA collects evidence for every criterion in turn, in one context that keeps growing.
- triage and diagnose fill the main context with the files they read, before the work that needs that context.
- diagnose ranks 3–5 hypotheses, but the agent that came up with the first idea is the one ranking them and testing them.

## Wanted

Each of the three skills uses subagents only where they pay off, and keeps the existing fallback: "when you cannot start subagents, do it yourself" (not every adapter has them).
- **norn-qa**: when a story has several independent criteria, collect each criterion's evidence in its own subagent, which writes the criterion's evidence files. The main agent sets up the environment once and writes the criteria report.
- **norn-triage**: a subagent reads the code and comes back with the `file:line` usages and the conclusion, not the files themselves.
- **norn-diagnose**: during exploration, a subagent finds the code involved. Optionally, a fresh subagent that is given only the loop and the symptom proposes hypotheses that aren't anchored on the main agent's first idea.

No blanket "use subagents" line in the brief, because subagents cost tokens and lose detail at every handoff.

A subagent that writes files or runs commands (QA's subagents do both) gets the brief's hard rules it could break, as #301 item 5 asks.

## Where

- `packages/cli/assets/skills/norn-qa/SKILL.md:10` (Check, steps 1–6)
- `packages/cli/assets/skills/norn-triage/SKILL.md:16` (2. Check it still applies)
- `packages/cli/assets/skills/norn-diagnose/SKILL.md:41` (3. Hypothesise)
- Example of the pattern: `packages/cli/assets/skills/norn-review/SKILL.md:20`
- Related: #301 (subagents run without How to work)
