# gh-301 — handoff

## Goal

Close the seven gaps in norn's agent instructions: reasons for How to work's rules, a Where you run section, precedence over skills, hooks that repeat the rules, rules for subagents, an exact-versus-principled rule (applied to `norn-review`), and lasting preferences via `norn-retro`.

## Proof

- Refinement: spec.md holds Problem Statement, Solution, 46 user stories, Out of Scope and Further Notes; no open questions. Confirmed by a delegate answering for Jakub.
- Plan: spec.md's Plan section has five seams (the brief renderer; a pure hook-answer function in core; `norn hook` through the cli harness; each adapter's `hookResponse` and new `toolCall`; skill and doc text via `assets.test.ts` pins, the docs lint and review), a coverage row for every user story, three prefactors, decisions D1–D17 and risks. Agreed by the delegate for Jakub. `bun test test/repo` green.

## Easy to miss

- The hooks are a reminder, not a sandbox: they fail open, judge `gh`/`glab` against a list of known writes (everything else allowed), and inspect file tools only for writes under the checkout's whole `runs/` folder.
- Tool refusals are traced `blocked`, but the turn-end cap must count only `turn_end` lines (D9), or three denied pushes spend the run's turn-end blocks.
- The `--json` brief replaces the prose `mode_note` with the fact `mode_requested` and gains `runner` (D1).
- A bare `git checkout <name>` is refused only when the cli's rev-parse resolves it and no `--` follows (D6).
- The permission-prompt line in Where you run is for unattended steps only.
- The skill lines dropped are exactly the four in D15; "Commit locally" stays.

## Not proven yet

- Everything past planning: slices, build, QA. The Codex and Gemini deny and added-context encodings are taken from their docs, not observed.

## Notes

- The person chose one story for all seven gaps; slice along brief and hooks versus skills. Prefactors (one hard-rules list in core; the turn-end decision moved into a pure core hook-answer function; `protocolLines` takes the step) land first.
- The `norn-review` before/after comparison is QA by an agent (verifier: agent): old and new outputs go in the evidence; Jakub reviews at the PR.
- `norn-fsd-round` is out of scope for the subagent rule (it runs outside a step).
- Claude's hook installer already registers SessionStart, UserPromptSubmit and PreToolUse, so existing installs need no reinstall; OpenCode is `hooks` tier and gets allow only.

## Resume

Plan agreed and written; next is slicing the Plan into slice files.
