---
id: gh-111
slug: a-claude-session-that-loses-its-login
provider: gh
number: 111
url: https://github.com/PruszynskiJakub/norn-next/issues/111
title: A Claude session that loses its login mid-step is classified silent and nudged until stuck, without saying it was logged out
assignee: PruszynskiJakub
labels:
  - friction
  - norn
workflow: triage
status: active
intake_at: 2026-10-30T11:31:18.349Z
body_hash: 4bc0a7b74656872747f7b5551596d3bd718de25b0fbbef52a8a354edb9c21d4d
---

## Observed

When a Claude session's login expires during a step, Claude stops working on prompts. norn sees a turn end with no receipt and classifies it `agent.silent`. Each nudge goes into a session that cannot act on it, using up the run's nudges, and the unit then goes `stuck`. Neither the stuck reason nor the inbox says the agent was logged out; the person finds that out only by looking at the pane.

Seen in an agent handoff: "A Claude session that loses its login mid-step comes out as silent, and norn burns its nudges on it before marking it stuck. It doesn't say the agent was logged out."

## Wanted

- The Claude adapter recognises the logged-out state from a hook fact: a Claude Code hook event or error type for a failed turn, or the transcript's last API error. Which signal Claude Code gives is the first thing to check.
- norn treats it like the usage-limit wait: a `waiting_input` implicit ask such as "agent logged out — run `/login` in the pane", with no nudges spent.
- After the login succeeds, the run continues in the same session.

## Repro

1. In a throwaway repo, start a story whose agent step runs in a Claude session.
2. Log the session out mid-step (or let its token expire).
3. Watch the ticks: `agent.silent` → nudge → … → `stuck`, with no mention of the login.

## Where

- `packages/adapters/src/claude/index.ts:49-63`: `NOTIFICATION_EVENTS`; `auth_success` is ignored and nothing maps a failed login
- `packages/adapters/src/claude/index.ts:109`: turn end taken from `Stop` only
- `packages/core/src/decide/agent.ts:243`: `agent.silent` ("turn ended without a receipt")

## PRD

A2 (hook facts), §10 (silent → nudge, implicit asks), B2 (nudges into the same session).
