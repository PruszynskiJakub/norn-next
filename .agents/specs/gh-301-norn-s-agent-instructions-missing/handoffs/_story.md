### Goal

Close the seven gaps in norn's agent instructions: reasons for How to work's rules, a Where you run section, precedence over skills, hooks that repeat the rules, rules for subagents, an exact-versus-principled rule (applied to `norn-review`), and lasting preferences via `norn-retro`.

### Proof

- Refinement: spec.md holds Problem Statement, Solution, 46 user stories, Out of Scope and Further Notes; no open questions. Confirmed by the person (a delegate answering for Jakub).

### Easy to miss

- The hooks are a reminder, not a sandbox: they fail open, use a list of known `gh`/`glab` writes (everything else allowed), and inspect file tools only for writes under run state.
- The PreToolUse refusals apply in attended steps too; they have no cap (unlike the end-of-turn hook's limit).
- The `--json` brief gains only the runner as a fact; no rendered prose in JSON.
- The skill lines dropped must be exactly those the brief now covers.

### Not proven yet

- Everything past refinement: plan, slices, build.

### Notes

- The person chose one story for all seven gaps; slice along brief and hooks versus skills.
- `norn-fsd-round` is out of scope for the subagent rule (it runs outside a step).
- Only `norn-review` is rewritten to the exact-versus-principled rule; other skills are a later story.
- Claude's hook installer already registers SessionStart, UserPromptSubmit and PreToolUse, so existing installs need no reinstall; OpenCode is `hooks` tier and may be unable to refuse.

### Resume

Refinement is done; the next step is planning the spec.
