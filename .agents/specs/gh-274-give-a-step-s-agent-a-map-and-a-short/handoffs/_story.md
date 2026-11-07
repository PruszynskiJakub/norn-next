## Goal

Refine gh-274 into an umbrella spec (all nine wanted items), sliced later, guided by "remove more context and machinery than you add".

## Progress

- Interview settled every branch with the person; spec body written (B1–B47, Out of scope, no open questions).
- Key decisions: brief references files (path + generic description), never pastes them; no generated map and no `files:` list (AGENTS.md Layout is the map); RULES.md and all id comments removed, invariants move to docs/dev/contracts.md; brief is the first prompt, protocol stated once, norn skill a fallback; Claude clean profile via built-in args; handoff becomes a norn-written journal, 150-word `--handoff` cap.
- Suggested slice order: metrics → brief → start/instructions → AGENTS.md + docs/dev + RULES removal → session profile → journal → comments.

## Resume

Person reviews spec.md; on agreement report `norn done done`.
