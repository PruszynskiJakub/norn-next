---
id: gh-75/05
title: status --watch replaces the cockpit; run attach
depends_on: [gh-75/03, gh-75/04]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: test }
  - { id: AC7, verifier: agent }
---

## Goal
The live cockpit opens with `norn status --watch` (`--pane` splits a Herdr pane for it), and focusing an agent's pane is `norn run attach [<unit>]` / `run attach --next`. `cockpit` is gone.

## Scope
Behaviour: B5 (for `cockpit`), B11, B12, B46, B47. Seams: S1 (fake Herdr, scripted keys). Out: the cockpit's action strings naming new commands (B7, slice 14).

## Acceptance
- AC1 (B11) Given scripted keys, when `norn status --watch` runs, then it draws the cockpit (what needs you, every story, the selected row's preview, actions by key) until q or Esc; `--interval 5s` sets the refresh as `cockpit --interval` did; `status --watch --json` prints the cockpit model JSON `cockpit --json` printed, while `status --json` stays the inbox JSON (B10). — verifier: test
- AC2 (B12) Given the harness inside Herdr, when `norn status --watch --pane` is typed, then the fake Herdr records a split below the caller running the cockpit; outside Herdr it is refused with the reason and do_instead `norn status --watch`. `--pane` is listed in `norn help status`. — verifier: test
- AC3 (B46) Given a unit with a live Herdr pane, when `norn run attach <unit>` is typed, then the fake Herdr records a focus of that pane; a unit with no live pane is refused `nothing_to_attach`, giving the unit's start command when it has one. Without a target it resolves as slice 03 does, offering only units with a live pane. — verifier: test
- AC4 (B47) Given two Your turn units, when `norn run attach --next` is typed, then the older one's pane is focused without prompting; none → refused `nothing_to_attach`; output as `cockpit --next` printed. — verifier: test
- AC5 (B2) `norn run` lists `attach` among its verbs. — verifier: test
- AC6 (B5) `norn cockpit` (any flags) is a usage error (exit 2) "Unknown command: cockpit". — verifier: test
- AC7 (B11) In a real terminal, `bun packages/cli/src/main.ts status --watch` in a throwaway repo draws, refreshes and quits on q. — verifier: agent

## Checks
- `bun test packages/cli`
- `bun run typecheck`

## Notes
The spec's map sends `cockpit --json` to `status --json`, but B10 keeps `status --json` as the inbox's JSON; this slice keeps both by giving the cockpit model under `status --watch --json` (the framework's rule that a screen-drawing command prints data under `--json`). The person may prefer dropping the cockpit model JSON instead; say so at approve-plan. The CP13 behaviour (no repository → the last cockpit's repository) moves with it. The Herdr plugin still calls `cockpit` until slice 15 rewrites it; one release, so nothing ships broken.
