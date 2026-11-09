# QA gh-301: report

How it ran: brief rendering through `renderBrief` for all 12 combinations of attended, mode and runner (where-combos.md), and the real `norn brief` / `norn hook` cli path through the harness in a throwaway repo (an unattended unit gh-9 and an attended unit gh-10, hooks as `norn init` installs them): ~70 shell commands, file-tool writes, session starts and prompts for Claude, Codex, Gemini and OpenCode. The skill-text criteria were read in the sources. Agent criteria: the new norn-review re-run on two past diffs, and norn-retro run on two fixture repos. Scratch drivers were removed; the worktree is clean.

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| 01.AC1 survey rule gives its reason | pass | cli-brief.md How to work | |
| 01.AC2 four-commands rule gives its reason, names `norn status --json` / `norn story view` | pass | cli-brief.md | |
| 01.AC3 run state / push / switch rules give their reasons | pass | cli-brief.md | |
| 01.AC4 every hard rule has a reason from the one list; a blank reason fails a test | pass | 01-AC4-mutation.md | blanking one reason turned "every hard rule comes from the one list…" red |
| 02.AC1 end-of-turn hook blocks and caps as before | pass | 05-retry.md | 3 blocks then allow; attended never blocks (agent-protocol integration test, supporting-tests.log) |
| 02.AC2 Claude/Codex/Gemini deny and add-context encodings | pass | 02-adapters.md, 07-notes.md | Gemini BeforeTool `decision: deny`; SessionStart/UserPromptSubmit/BeforeAgent `additionalContext` |
| 02.AC3 OpenCode / an event that can't carry it → allow | pass | 02-adapters.md | OpenCode push → `{}`; other events from the adapter unit tests |
| 02.AC4 toolCall reads shell, file tools, EnterWorktree, else null | pass | 05-shell.md, 06-runstate.md, 02-adapters.md | Gemini `replace` only in adapter unit tests |
| 02.AC5 outside a unit or on an error → allow | pass | 05-ac6.md, 07-notes.md | outside a unit, garbage stdin, broken PATH, corrupt state.json |
| 03.AC1 How to work outranks skills; a skill can't prompt another command | pass | cli-brief.md | |
| 03.AC2 the three mapping rows | pass | brief-unattended.md | |
| 03.AC3 the ask row follows attended vs unattended | pass | brief-attended.md, brief-unattended.md | note: the attended mapping still reads "stop, or wait for input → `norn stuck` or `norn ask`" |
| 03.AC4 subagent rule | pass | cli-brief.md | |
| 04.AC1 Where you run after the opening line, before Your work | pass | where-combos.md | all 12 combinations |
| 04.AC2 attended lines; no "Attended step" banner | pass | where-combos.md | |
| 04.AC3 unattended runner, `norn ask` parks the step, permission-prompt line only when unattended | pass | where-combos.md | |
| 04.AC4 auto vs manual report lines | pass | where-combos.md | |
| 04.AC5 auto with no runner → manual, says why; no "Mode:" line | pass | where-combos.md | |
| 04.AC6 `--json` where: attended, mode, mode_requested, runner; no mode_note | pass | where-json.json, cli-brief.json | |
| 04.AC7 every line follows from a fact; no supervisor promise | pass | where-combos.md | attended + auto says the report starts the next step at once (the comment in brief.ts says so for the unattended step that follows) |
| 05.AC1 push denied in every form | pass | 05-shell.md | env, -C, -c, ; && \|\| \| and newline |
| 05.AC2 switches denied; unresolved path / `--` allowed | pass | 05-shell.md | |
| 05.AC3 listed gh/glab writes denied | pass | 05-shell.md | including api -X/--method/-f/-F/--field/--raw-field/--input |
| 05.AC4 reads, quoted push, unreadable command allowed | pass | 05-shell.md | |
| 05.AC5 refused on every retry, traced blocked, cap untouched | pass | 05-retry.md | 56 blocked tool lines, then still 3 turn-end blocks |
| 05.AC6 works with the installed hooks; fails open | pass | setup.md, 05-ac6.md | |
| 05.AC7 limitations entry says reminder, not sandbox, and names what it misses | pass | docs/limitations.md diff; docs lint green (supporting-tests.log) | |
| 06.AC1 file-tool writes under any unit's runs/ denied with the corrupt reason | pass | 06-runstate.md | Write/Edit/MultiEdit/NotebookEdit, other unit, Gemini, Codex apply_patch |
| 06.AC2 relative, symlinked, not-yet-existing paths resolved | pass | 06-runstate.md | |
| 06.AC3 reads, shell writes, writes elsewhere allowed | pass | 06-runstate.md | |
| 07.AC1 compact/resume/clear note with unit, step, outcomes, rules, `norn brief` | pass | 07-notes.md | Claude, Codex, Gemini |
| 07.AC2 no note on startup, outside a unit, corrupt state | pass | 07-notes.md | gate-step case in agent-protocol test |
| 07.AC3 attended prompt reminder; none when unattended | pass | 07-notes.md | |
| 07.AC4 with the installed hooks | pass | setup.md, 07-notes.md | |
| 08.AC1 Development › Skills exact-or-principled rule | pass | docs/development.md diff; docs lint green | |
| 08.AC2 norn-review keeps its contracts, no fixed prompts or word caps | pass | packages/cli/assets/skills/norn-review/SKILL.md; assets pins green | old text had "Under 400 words" prompts; gone |
| 08.AC3 subagent rules with reasons | pass | norn-review SKILL.md step 4 | "No command of the delivery tool" stands for "no norn command" (craft-skill lint); the person may confirm the wording |
| 08.AC4 before/after on two past diffs | person | 08-AC4.md, 08-gh273-probe.txt | not met as worded: blocking finding on the clean diff, but it is a real missed regression |
| 09.AC1 exactly the four lines dropped | pass | skill diffs; grep finds none; assets pins green | |
| 09.AC2 no skill names the mode | pass | grep over packages/cli/assets/skills; assets pins green | |
| 10.AC1 retro lists the gate rulings and asks which are lasting | pass | norn-retro SKILL.md §3; pins green | |
| 10.AC2 proposes a REVIEW.md / AGENTS.md line: file, section, wording, ruling | pass | norn-retro SKILL.md §3; pins green | |
| 10.AC3 still changes no file | pass | norn-retro SKILL.md; pin green | |
| 10.AC4 creates a missing file; cites an existing line | pass | 10-AC4.md | |
