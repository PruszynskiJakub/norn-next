# gh-301 — handoff

## Goal

Close the seven gaps in norn's agent instructions: reasons for How to work's rules, a Where you run section, precedence over skills, hooks that repeat the rules, rules for subagents, an exact-versus-principled rule (applied to `norn-review`), and lasting preferences via `norn-retro`.

## Proof

- Refinement, slicing and plan: spec.md (46 user stories; Plan with five seams, D1–D17) and ten slice files, 44 criteria in spec.md's frontmatter; agreed by the delegate for Jakub.
- Build: slices 01–10 integrated; test#1 (`bun install --frozen-lockfile && bun run test && bun run typecheck`) pass.
- QA #1: 43 of 44 criteria pass, one line each in the run's evidence `report.md`. Observed through the real `norn brief` / `norn hook` cli path in a throwaway repo: the brief in all 12 combinations of attended, mode and runner; ~70 shell commands (push, switch and remote-write refusals, reads allowed); file-tool writes under run state (relative, symlinked, new paths); session notes and the attended reminder for Claude, Codex and Gemini; OpenCode allows; fails open outside a unit, on garbage input, with a broken PATH or corrupt state. norn-retro run on two fixture repos: proposes creating a missing `REVIEW.md`, and cites the line where it already says it.

## Easy to miss

- The hooks are a reminder, not a sandbox: they fail open, judge `gh`/`glab` against a list of known writes (everything else allowed), and inspect file tools only for writes under the checkout's whole `runs/` folder.
- Tool refusals are traced `blocked`, but the turn-end cap counts only `turn_end` lines (D9); QA saw 56 refusals and still 3 turn-end blocks.
- The `--json` brief replaces the prose `mode_note` with the fact `mode_requested` and gains `runner` (D1).
- A bare `git checkout <name>` is refused only when the cli's rev-parse resolves it and no `--` follows (D6).
- The skill lines dropped are exactly the four in D15; "Commit locally" stays.

## Not proven yet

- The norn-review before/after on two past diffs (`08.AC4`, the rewrite loses nothing) is **not met as worded**. On gh-273, the diff whose review passed clean, the new skill raises one blocking finding in both samples. That finding (a `#` line inside a fenced block ends Progress) is a real regression at 4b9567c that the original review missed: QA's `08-gh273-probe.txt` shows it, and the old skill raises it too. On gh-249 the new skill raised the original GitLab-draft defect in QA's re-run and missed it in implement's run. Jakub decides at the PR (D17) whether this counts as losing nothing or another clean diff is needed; QA's `08-AC4.md` has the table.
- Codex and Gemini encodings were checked against payloads modelled on their docs, not against the live tools.

## Notes

- For the person, from QA: in an attended brief the skill mapping still reads "stop, or wait for input → `norn stuck` or `norn ask`" next to "never `norn ask`". norn-review words the "no norn command" subagent rule as "No command of the delivery tool", because the craft-skill lint bans the word; confirm that wording.
- Reviewer re-runs are single samples of a non-deterministic judge.
- `norn-fsd-round` is out of scope for the subagent rule (it runs outside a step). Claude's hook installer already registers SessionStart, UserPromptSubmit and PreToolUse, so existing installs need no reinstall; OpenCode gets allow only.
- Friction: no real story's record had a gate ruling that reads as lasting, so QA built a fixture (a bare remote holding `refs/norn/runs/gh-7`) for the retro check.

## Resume

pr.md in the spec folder describes the branch at its current head, one evidence entry per user story from QA #1. At the PR, Jakub judges the norn-review before/after (`08-AC4.md`), the attended stop row and the "No command of the delivery tool" wording; the AGENTS.md retro proposal was not exercised in a run.
