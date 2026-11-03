---
id: gh-175
slug: norn-story-wait-blocks-until-a-story
provider: gh
number: 175
url: https://github.com/PruszynskiJakub/norn-next/issues/175
title: norn story wait blocks until a story reaches a step, gate or end, for supervisors
assignee: PruszynskiJakub
labels:
  - friction
  - norn
  - norn:wf:quick
workflow: quick
status: new
intake_at: 2026-11-03T11:42:41.614Z
body_hash: cecf73e8284fca723f50065c69bdc3977a9286657cd992f60e6f261049ad3ebb
---

## Observed

A person or agent supervising a story from outside (e.g. "guide gh-64 to release") has no way to wait for a state change. It polls `norn status` or watches log output for text. One such watcher stopped early because its stop pattern "done" matched the status line `sync → done`.

## Wanted

`norn story wait <story> --until <condition> [--timeout <d>] [--json]` blocks until the condition holds on the story's state, then prints the state as JSON. Conditions: `step=<name>`, `gate` (parked at a gate), `ask`, `stuck`, `done` (round ended), `merged`. Exit codes tell met, timed out and refused apart (P8), so a supervisor branches on the exit code, never on text.

## Rules

P8.
