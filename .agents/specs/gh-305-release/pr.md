## Release 0.30.0

**Version:** 0.30.0, minor: #304 adds hook refusals, session notes and retro proposals, changes the brief, and changes the machine contract (`norn brief --json` drops `mode_note` for `where`).

### [0.30.0] - 2026-11-09

#### Added

- Inside a unit, norn's hooks now refuse what a step must not do, each with its reason: `git push` in any form, a branch or worktree switch (`git switch`, `git checkout -b <branch>` or `<branch>`, `gh pr checkout`, `git worktree add/move/remove`), the known `gh`/`glab` writes (create, edit, comment, review, merge, close, labels, releases, `api` with a method or fields), and a file-tool write under any unit's run state. Reads and every other command pass. The hooks `norn init` already installs carry this for Claude, Codex and Gemini; OpenCode allows everything as before. A hook fails open on its own error and does nothing outside a unit, and `docs/limitations.md` says what it misses: it is a reminder, not a sandbox.
- After a compact, resume or clear, a session gets a note naming its unit, step and outcomes and the hard rules with their reasons, ending "Run `norn brief` for the rest". A fresh session gets none. In an attended step every prompt carries a reminder to ask in the session and to report `norn done` only once the person agrees.
- The shipped `norn-retro` skill lists the story's gate rulings and asks which are lasting, then proposes a line for `REVIEW.md` (a ruling on how work is judged) or for `AGENTS.md`, else `CLAUDE.md` (a ruling on how agents work), naming the file, section, wording and ruling. It proposes creating a missing file, cites a line that already states the ruling, and still changes no file.

#### Changed

- The brief gives the reason for every hard rule in How to work (no survey, only `brief`/`done`/`ask`/`stuck`, never edit run state, never push, never switch branches), and a skill joins the list of things that cannot prompt another norn command.
- A Where you run section opens every brief, replacing the mode line and the attended banner: who reads the session (a person, or no one in a named runner, where a question goes through `norn ask` and a permission prompt parks the step) and what a report sets off (the next step at once in auto, a person in manual, and auto falling back to manual with no runner).
  - `norn brief --json` drops the prose `mode_note` for `where`: `attended`, `mode`, `mode_requested` and `runner`.
- How to work outranks any skill, maps what a skill says (ask, stop, push or open a PR, run another command) to the step, and says which rules to give a subagent: the ones its work can break, each with its reason.
- The shipped `norn-review` skill states what each axis must cover and why instead of fixed subagent prompts and word caps, and hands its subagents the rules they can break. Its two axes, traceability table, findings JSON and blocking checks are unchanged. The shipped skills no longer repeat "never push" and "never create or switch branches", which the brief now says.
