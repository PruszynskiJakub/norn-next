# gh-301 — handoff

## Goal

Close the seven gaps in norn's agent instructions: reasons for How to work's rules, a Where you run section, precedence over skills, hooks that repeat the rules, rules for subagents, an exact-versus-principled rule (applied to `norn-review`), and lasting preferences via `norn-retro`.

## Proof

- Refinement: spec.md holds Problem Statement, Solution, 46 user stories, Out of Scope and Further Notes; no open questions. Confirmed by a delegate answering for Jakub.
- Slicing: ten slice files in `slices/` (01 rule reasons, 02 hook answers in core + adapter encodings and `toolCall`, 03 precedence and subagents, 04 Where you run, 05 shell refusals + limitations doc, 06 run state write refusals, 07 session-start note and attended reminder, 08 `norn-review` rewrite + exact-vs-principled rule + comparison, 09 dropped skill lines, 10 `norn-retro` preferences); every user story cited by some criterion; 44 criteria mirrored in spec.md's frontmatter. `bun test test/repo` green.
- Plan: spec.md's Plan section has five seams (the brief renderer; a pure hook-answer function in core; `norn hook` through the cli harness; each adapter's `hookResponse` and new `toolCall`; skill and doc text via `assets.test.ts` pins, the docs lint and review), a coverage row for every user story, three prefactors, decisions D1–D17 and risks. Agreed by the delegate for Jakub. `bun test test/repo` green.

## Easy to miss

- The hooks are a reminder, not a sandbox: they fail open, judge `gh`/`glab` against a list of known writes (everything else allowed), and inspect file tools only for writes under the checkout's whole `runs/` folder.
- Tool refusals are traced `blocked`, but the turn-end cap must count only `turn_end` lines (D9), or three denied pushes spend the run's turn-end blocks.
- The `--json` brief replaces the prose `mode_note` with the fact `mode_requested` and gains `runner` (D1).
- A bare `git checkout <name>` is refused only when the cli's rev-parse resolves it and no `--` follows (D6).
- The permission-prompt line in Where you run is for unattended steps only.
- The skill lines dropped are exactly the four in D15; "Commit locally" stays.

## Not proven yet

- Everything past slicing: build, QA. The Codex and Gemini deny and added-context encodings are taken from their docs, not observed.

## Notes

- Slice graph: critical path two levels (01 or 02 → 05/06/07). The rules list carries its reasons from slice 01, so the hook slices reuse real text. Slice 02 holds the whole hook-answer contract (union, encodings, `toolCall`) so 05–07 don't each add it. 03 has no edge on 01 despite both editing How to work (merge conflict only).
- Slice 10's missing-file and duplicate cases are an agent check (the Plan had them at review) so QA gives them a verdict.

- The person chose one story for all seven gaps; slice along brief and hooks versus skills. Prefactors (one hard-rules list in core; the turn-end decision moved into a pure core hook-answer function; `protocolLines` takes the step) land first.
- The `norn-review` before/after comparison is QA by an agent (verifier: agent): old and new outputs go in the evidence; Jakub reviews at the PR.
- `norn-fsd-round` is out of scope for the subagent rule (it runs outside a step).
- Claude's hook installer already registers SessionStart, UserPromptSubmit and PreToolUse, so existing installs need no reinstall; OpenCode is `hooks` tier and gets allow only.

## Resume

Slices written; next is the person's approval of the slice files, then 01, 02, 03, 04, 08, 09 and 10 start in parallel; 05, 06 and 07 wait on 01 and 02.
