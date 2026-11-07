## Goal

Plan gh-274: seams, coverage, decisions and risks in spec.md's Plan, guided by "remove more context and machinery than you add".

## Progress

- refine#1: umbrella spec B1–B49 written with the person (see spec).
- plan#1: Plan written with the person. Seams S1 renderBrief, S2 agent protocol in the cli harness, S3 config + Claude launchCommand, S4 report/decision commands → handoff file, S5 repo lints, S6 init. No prefactoring.
- Amended with the person: B1–B6 (orientation metrics) dropped, too much machinery; B20/B21/B24 now a one-line first prompt "Run `norn brief` in this worktree and do what it says." (no brief-as-prompt, no hook-started run); B28 dropped (chat gets the clean profile; override via args); B22's example points at B48's order.
- The person wants it kept simple: every decision avoids new action shapes, receipt fields, adapter methods or commands.
- plan#1 done: Plan written with the person. Seams S1 renderBrief, S2 agent protocol (harness), S3 config + Claude launchCommand, S4 report/decision commands → handoff journal, S5 repo lints, S6 init; no prefactoring; D1–D11; risks: clean-profile spike, D10 id strip as its own last slice. Spec amended: B1–B6 and B28 dropped; B20/B21/B24 a one-line prompt 'Run norn brief in this worktree and do what it says'; B22 example follows B48. Next: slice.

## Resume

Slice the spec (norn-slice). Order suggested: prompt + norn skill → brief trim → journal → AGENTS.md + docs/dev + RULES removal → clean profile (spike first) → id strip (D10, its own slice, last).
