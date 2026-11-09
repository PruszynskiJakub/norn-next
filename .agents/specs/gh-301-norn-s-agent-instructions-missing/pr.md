## Summary

Agents in a norn step now get the reason behind each hard rule, a "Where you run" section that says who reads the session and what their report sets off, a rule that How to work outranks skills and binds subagents, and hooks that repeat the rules: they refuse pushes, branch switches, remote writes and run-state edits, and re-orient a session after compaction. `norn-review` is rewritten to state the outcomes it needs instead of fixed prompts, and `norn-retro` proposes lasting preferences for `REVIEW.md` / `AGENTS.md`.

```
core/hard-rules.ts      one list: rule text + reason
  ├─ brief.ts           How to work (rule — reason), Where you run, skill mapping, subagent rule
  └─ hook.ts            hookAnswer(event, toolCall, unit) → allow | deny(reason) | addContext(note)
       └─ shell-refusals.ts   git push · switch/checkout/worktree · known gh/glab writes
cli hook.ts             reads the payload through the adapter, asks core, fails open on any error
adapters/*              encode deny / additionalContext per tool (Claude, Codex, Gemini; OpenCode allows)
```

## Evidence

QA ran through the real `norn brief` / `norn hook` cli path in a throwaway repo; one line per criterion in [report.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/report.md).

- **Survey rule says why**
  **Before:** "do not survey the repository…" with no reason.
  **After:** "…the brief already holds what this step needs, a survey spends context on what it doesn't, and other units' run state and handoffs are not this unit's to act on" ([cli-brief.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/cli-brief.md)).
- **Four norn commands rule says why**
  **Before:** bare rule. **After:** reason given and names `norn status --json` / `norn story view` as forbidden too ([cli-brief.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/cli-brief.md)).
- **Run state rule names `corrupt`**
  **Before:** bare rule. **After:** "a hand-edited file fails validation and makes the unit `corrupt`" ([cli-brief.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/cli-brief.md)).
- **Push rule names receipts**
  **Before:** bare rule. **After:** "a push outside norn is an effect with no receipt, and receipts come before effects" ([cli-brief.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/cli-brief.md)).
- **Switch rule says why**
  **Before:** bare rule. **After:** "a switch leaves the unit's branch, where norn commits what is left at the report" ([cli-brief.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/cli-brief.md)).
- **Every hard rule carries a reason**
  **Before:** no reasons. **After:** all come from one list in core; blanking one reason turns a unit test red ([01-AC4-mutation.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/01-AC4-mutation.md)).
- **A skill can't prompt another norn command**
  **Before:** "a refusal, this brief or the inbox". **After:** "a skill" added to that list ([cli-brief.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/cli-brief.md)).
- **Where you run opens every brief**
  **Before:** did not exist. **After:** right after the opening line, before Your work, in all 12 combinations of attended, mode and runner ([where-combos.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/where-combos.md)).
- **Attended: ask here, `done` once the person agrees**
  **Before:** an "Attended step" banner. **After:** "A person works with you in this session: ask them here, not with `norn ask`, and report `done` only once they agree" ([brief-attended.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/brief-attended.md)).
- **Unattended: runner named, questions through `norn ask`**
  **Before:** did not exist. **After:** "You run unattended in a herdr pane: no person reads this session. A question goes through `norn ask`, which parks the step…" ([brief-unattended.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/brief-unattended.md)).
- **Auto: the report starts the next step at once**
  **Before:** a "Mode:" line. **After:** "…The next agent has only the handoff and the receipts, so write a handoff that stands on its own" ([where-combos.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/where-combos.md)).
- **Manual: the next step waits for a person**
  **Before:** a "Mode:" line. **After:** the manual line, in every manual combination ([where-combos.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/where-combos.md)).
- **Auto with no runner falls back to manual, says why**
  **Before:** labelled only. **After:** the reason and what it means for the report ([where-combos.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/where-combos.md)).
- **A permission prompt parks the step**
  **Before:** did not exist. **After:** the line, in unattended briefs only ([brief-unattended.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/brief-unattended.md)).
- **One place replaces the mode line and banner**
  **Before:** two separate lines. **After:** neither appears in any combination ([where-combos.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/where-combos.md)).
- **`--json` brief carries the runner as a fact**
  **Before:** a prose `mode_note`. **After:** `where` has `attended`, `mode`, `mode_requested`, `runner`; no `mode_note` ([where-json.json](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/where-json.json), [cli-brief.json](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/cli-brief.json)).
- **Where you run states only what norn records**
  **Before:** did not exist. **After:** every line follows from a fact; no supervisor promise ([where-combos.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/where-combos.md)).
- **How to work outranks any skill**
  **Before:** silent on clashes. **After:** "How to work outranks any skill: where a skill… says otherwise, do what this section says" ([brief-unattended.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/brief-unattended.md)).
- **What a skill says maps to the step**
  **Before:** did not exist. **After:** the ask / stop / push-or-PR / other-command rows ([brief-unattended.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/brief-unattended.md)).
- **The ask row follows attended or not**
  **Before:** did not exist. **After:** `norn ask` unattended, ask in the session attended ([brief-attended.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/brief-attended.md)). The attended stop row still reads "`norn stuck` or `norn ask`": worth a look.
- **Note after compact, resume or clear**
  **Before:** nothing. **After:** unit, step, outcomes, the hard rules with reasons, "Run `norn brief` for the rest", for Claude, Codex and Gemini ([07-notes.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/07-notes.md)).
- **No note on a fresh session**
  **Before:** nothing. **After:** `startup` answers `{}`; so do outside a unit and corrupt state ([07-notes.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/07-notes.md)).
- **`git push` refused with its reason**
  **Before:** allowed. **After:** denied in every form (env prefix, `-C`, `-c`, `;`, `&&`, `||`, `|`, newline) with "…if you want this pushed, run it yourself" ([05-shell.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/05-shell.md)).
- **Branch or worktree switch refused**
  **Before:** allowed. **After:** `switch`, `checkout -b/-B/--orphan/--detach/-/<branch>`, `gh pr checkout`, `git worktree add/move/remove` denied; `checkout README.md`, `checkout -- main` allowed ([05-shell.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/05-shell.md)).
- **Known `gh`/`glab` writes refused**
  **Before:** allowed. **After:** PR/MR/issue create, edit, comment, review, ready, merge, close, reopen; labels; releases; repo edit/delete; `api` with `-X`/`--method`/`-f`/`-F`/`--input` denied ([05-shell.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/05-shell.md)).
- **Every other `gh`/`glab` command allowed**
  **Before:** allowed. **After:** still allowed: `view`, `list`, `status`, `diff`, `checks`, GET `api`, a quoted push, an unreadable command ([05-shell.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/05-shell.md)).
- **File-tool writes under run state refused**
  **Before:** allowed. **After:** Write/Edit/MultiEdit/NotebookEdit, Gemini, Codex `apply_patch`, any unit's `runs/`, relative, symlinked and new paths denied with the `corrupt` reason; reads and shell writes not inspected ([06-runstate.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/06-runstate.md)).
- **Attended prompt reminder**
  **Before:** nothing. **After:** every prompt gets "report `norn done` only once the person agrees… ask in this session rather than with `norn ask`"; none unattended ([07-notes.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/07-notes.md)).
- **A refusal never runs out**
  **Before:** did not exist. **After:** 56 refused tool calls traced `blocked`, then the end-of-turn hook still blocks 3 times and allows ([05-retry.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/05-retry.md)).
- **Hooks fail open, do nothing outside a unit**
  **Before:** end-of-turn hook only. **After:** allow outside a unit, on garbage stdin, a broken PATH and corrupt `state.json` ([05-ac6.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/05-ac6.md)).
- **A tool that can't deny or add context keeps working**
  **Before:** works. **After:** OpenCode answers `{}` to a push; other events skip what they can't carry ([02-adapters.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/02-adapters.md)).
- **No reinstall needed**
  **Before:** n/a. **After:** refusals and notes work with the hooks `norn init` already installs ([setup.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/setup.md)).
- **Docs say reminder, not sandbox**
  **Before:** did not exist. **After:** a `docs/limitations.md` entry naming what the hooks miss; docs lint green ([supporting-tests.log](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/supporting-tests.log)).
- **Subagents work under the rules**
  **Before:** did not exist. **After:** "give it the ones its work can break, each with its reason… one that only reads needs none" ([brief-unattended.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/brief-unattended.md)).
- **`norn-review` hands those rules to its subagents**
  **Before:** none. **After:** no push, no switch, no run-state writes, and "No command of the delivery tool" (the craft-skill lint bans the word "norn" there): confirm that wording.
- **Contributor docs: exact versus principled**
  **Before:** did not exist. **After:** Development › Skills states when a skill must be exact and how it is written elsewhere; docs lint green.
- **`norn-review` rewritten to that rule**
  **Before:** fixed subagent prompts, "Under 400 words" caps. **After:** what each axis must cover and why; two axes, traceability table, findings JSON and blocking checks kept; asset pins green.
- **The rewrite loses nothing (for Jakub to judge)**
  **Before → After** on two past diffs ([08-AC4.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/08-AC4.md)): every blocking finding the new skill raised, the old raised too, and the new drops the old one's false blocking finding. Not met as worded: on gh-273, whose review passed clean, both skills raise "a `#` line inside a fenced block ends Progress", a real regression ([08-gh273-probe.txt](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/08-gh273-probe.txt)); on gh-249 the held GitLab-draft defect was raised in 1 of 2 samples (the old skill missed it too).
- **Skills drop only lines the brief covers**
  **Before:** "never push" / "never create or switch branches" in four skills. **After:** exactly those four clauses gone ("Commit locally" stays); no skill names the mode; asset pins green.
- **Retro lists gate rulings, asks which are lasting**
  **Before:** did not exist. **After:** both fixture rulings listed with gate and round, each read, the person asked ([10-retro-no-review.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/10-retro-no-review.md)).
- **Retro proposes a `REVIEW.md` line for a judging ruling**
  **Before:** did not exist. **After:** proposed under "Not findings" with the ruling cited ([10-retro-no-review.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/10-retro-no-review.md)).
- **Retro proposes an `AGENTS.md` / `CLAUDE.md` line for a working ruling**
  **Before:** did not exist. **After:** the skill picks `AGENTS.md`, else `CLAUDE.md`, for a ruling on how agents work; unverified in a run (both fixtures held a judging ruling): check by running the retro on a story with such a ruling.
- **Each proposal names file, section, wording, ruling**
  **Before:** did not exist. **After:** all four in the fixture proposal ([10-AC4.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/10-AC4.md)).
- **Missing file: propose creating it**
  **Before:** did not exist. **After:** "REVIEW.md (new file: propose creating it)" ([10-AC4.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/10-AC4.md)).
- **Already stated: cite the line, propose nothing**
  **Before:** did not exist. **After:** "Already stated", the existing "Do not report" line quoted ([10-retro-has-review.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/10-retro-has-review.md)).
- **Retro still changes no file**
  **Before:** changes none. **After:** `git status --short` empty after both runs ([10-AC4.md](evidence/_story/01M6ZXD7890DDGWWEV1FEGY1MK/10-AC4.md)).

Codex and Gemini encodings were checked against payloads modelled on their docs, not the live tools. Reviewer runs are single samples of a non-deterministic judge.

## Merge danger

**Door:** two-way: code, brief text and bundled skill text; a revert restores them. The `--json` brief drops `mode_note` for `mode_requested` and `runner`, which a reader of the JSON would notice.

**Blast radius:** every agent in a step: a false refusal blocks a legitimate command (the `gh`/`glab` check refuses only a list of known writes, and `git checkout <name>` only when it resolves to a ref with no `--`); every hook fails open on its own error.
