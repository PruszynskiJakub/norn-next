---
name: norn-retro
description: Run a retrospective over one finished story from its committed delivery record (per-unit state, numbered reports, check logs, handoffs) and this machine's local trace when present. Finds the friction, most severe first, and proposes one concrete change per finding (to a skill, a delivery definition, the config, the contributor docs or the spec template), each citing its evidence, in a retro.md a person reviews. Changes nothing else. Use when a person asks for a retro or retrospective on a story, usually after its pull request merges.
disable-model-invocation: true
---

# Retro

A person asks for this after a story's pull request merges. You read what the delivery left behind, find where it cost time, and suggest how to make the next story cheaper. You suggest; the person decides what to apply. You write one file, the report, and change nothing else.

## 1. Read the record

The person names the story: a key such as `gh-123`, or its folder `.agents/specs/<key>-<slug>/`. Ask if they did not. Read only: never edit anything under `runs/`, and run no command that changes the repository or the remote.

- **The spec**: `story.md` (Behaviour items, Plan) and each `slices/<nn>-<slug>.md` (acceptance, frontmatter `criteria` with `verifier` and `needs`).
- **The delivery record**: one folder per unit under `runs/`, `runs/_story/` for the story and `runs/<nn>-<slug>/` for each slice. In each:
  - `state.json`: `counters` (name: times its loop was taken), `visits` (stage name: entries), `attempt`, `status`, `park` (`kind`, `reason`), `nudges_used`, `retries_used`.
  - `workflow.yaml`: the definition this unit ran, pinned when it began. Its `counters` give each `max`; each edge with a `counter` is a loop.
  - `receipts/NNNN-<kind>.json`: numbered reports in the order they happened, each with `step`, `attempt`, `at` and `by`. By `kind`:
    - `done`: `outcome`, `handoff` (the agent's summary), `findings` (`severity`, `title`, `file`, `criterion`, `detail`), `criteria` (one `verdict` per criterion: `pass`, `fail`, `person` or `unverified`, with `reason` and `how`), `notes`;
    - `ask` (`question`, `options`; `implicit: true` with `command` when it was a permission prompt), then its `answer` (`answer`, `ask_receipt_id`);
    - `stuck` (`reason`) and the person's `unstick` (`to`, `reset`, `comment`);
    - `approve` and `reject` at a gate, with the person's `comment`;
    - `check`: `command`, `exit_code`, `duration_ms`, `reason: "timeout"`, `output_tail`, `log`;
    - `started`: `agent`, `model`, `retry: true` for a fresh session after one was lost;
    - `classify`: how a stage ended, judged from facts rather than reported. `outcome` is `silent`, `died`, `timeout`, `stalled`, `conflict`, `stale` or `exhausted`, with `rule`, `detail`, `route` and `counter` (`name`, `value`, `max`); `snapshot.last_message` is what the agent said last before it went quiet.
  - `logs/<run_id>.log`: the full output of a failed check.
  - `evidence/<run_id>/`: what QA saw.
  - `handoff.md`: a generated header, then Goal, Progress (what was tried and failed) and Resume.
- **The local trace**, only on the machine that ran the story: `.agents/*/trace/<YYYY-MM-DD>.jsonl`, one JSON object per line. It is not committed; when it is missing, say so in the report and work from the record alone. Keep the lines whose `unit` (or `fact.story`, `fact.slice`) is this story or one of its slices. By `type`:
  - `hook` with `fact.event: "permission_prompt"` and `fact.command`: commands that stopped for a permission prompt;
  - `reject` (`reason`): a report the tool refused;
  - `criteria` (`verdicts`, `unverified_needs`): criteria left unverified, counted per missing capability;
  - `tick` (`decisions[].rule`, `decisions[].result.ok`, `decisions[].result.error`): actions that failed.

  Next to the day files, `briefings/<run_id>/` holds what each agent was told and `transcripts/<run_id>/` what it said last.

## 2. Find the friction

Go through every unit. For each finding, keep the evidence as you go: the file and its number (`runs/02-invite-form/receipts/0014-reject.json`), or the trace file and line.

1. **Counters that ran high or ran out.** `counters` in `state.json` against `max` in the pinned `workflow.yaml`; a `classify` with `outcome: "exhausted"`; an `unstick` with `reset`. Read what sent the work back each time (the `findings`, the `reject` comment, the `check` output between loops). One cause behind most loops is the finding, not the count.
2. **Repeated rejects.** Two or more `reject` at the same gate, or rejects in different slices whose `comment` says the same thing.
3. **Stuck and lost sessions.** `stuck` reasons; `classify` with `died`, `silent`, `stalled` or `timeout`; `started` with `retry: true`; a high `nudges_used`. Read `snapshot.last_message` and the handoff's Progress for why.
4. **Asks a better spec or skill would have answered.** Pair each `ask` with its `answer`. Would the spec, the plan, the contributor docs or a skill have held that answer? An implicit `ask` with a `command` is a permission prompt: name the command.
5. **Criteria a machine could not check.** `unverified` verdicts, their `reason` and the criterion's `needs` (the trace's `unverified_needs` counts them): a missing capability. `person` verdicts on criteria an agent could check given a tool, a seed script or a fixture.
6. **Checks that failed for environment reasons**, not code: `exit_code` 126 or 127, `reason: "timeout"`, a service not running, a port in use, a missing secret, or a flaky test that passed on the next run with no change in between. Read `output_tail` and the `log`.
7. **Review findings that recur.** The same `title`, file or rule across slices' `findings`, or found again after rework.

Rank the findings by what they cost: a person pulled in to unblock or redo work, then a rework loop, then a lost session, then a wait for an answer, then a manual check a machine could have made. A finding that recurs across slices outranks a one-off. Leave out what went smoothly.

## 3. Suggest one change per finding

For each finding, suggest ONE concrete change, small enough to review in a minute: the exact rule text, key and value, or check command. Name the file it touches:

| File | When |
|---|---|
| a skill, `.agents/skills/<name>/SKILL.md` | an agent's craft fell short the same way more than once |
| a definition, `.agents/*/workflows/<name>.yaml` | a missing check before review (lint, type check), a counter `max`, a check's `run` or `timeout`, a stage's `deadline` or `agent`, where a verdict goes |
| `.agents/*/config.yaml` | `limits` (`deadline`, `stalled`, `nudges`, `retries`), an agent's `args`, or its `capabilities` matching the criteria's `needs` |
| contributor docs: `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, coding standards | a repo fact an agent asked for or got wrong; a judgement call review kept finding |
| the spec template: the refine skill's `SKILL.md` and `EXAMPLE.md` in `.agents/skills/norn-refine/` | asks and rejects that trace back to a gap in how specs are written |

Choose where the change belongs:

- **A mechanical mistake gets an automated check, not prose.** A fixed pattern, a banned API, an import shape or a file-location rule belongs in the repo's linter, a pre-commit hook or a check before review. Prose rules are for judgement calls.
- **Standards belong to review.** The implementing agent carries the most context; the reviewing agent gets a diff. Put a rule a reviewer can enforce where review reads it.
- **Contributor docs load into every agent.** Add a pointer to a doc, not the doc itself.
- **A capability gap is fixed where it lives**: give the agent the tool and declare it in `capabilities`, or send those criteria to an agent that has it.
- **A tight counter is rarely the fix.** Fix what caused the loops; raise a `max` only when the loops were each worth it.
- **Look for what exists first**: a check that is defined but not wired, a doc that already says it but no agent reads.
- **Bundled skills are replaced on reinstall.** The skills in `.agents/skills/` that came with the delivery tool are overwritten by its own copy. To change one, suggest a copy under a new name, plus the `skill:` line in `.agents/*/workflows/<name>.yaml` that points at the copy. A skill the repo wrote itself changes in place.

Never suggest a change without evidence in the record, and never two changes for one finding: pick the one that removes the cause.

## 4. Write the report

Write `retro.md` in the story's folder, `.agents/specs/<key>-<slug>/retro.md`, next to the spec and record it cites. If one exists, ask before replacing it. Quote evidence briefly and write `<REDACTED>` for any secret.

```markdown
# Retro: <key> <title>

Read: `runs/_story/` and <n> slices. Trace: <present, dates | not on this machine>.

## Summary

<Two or three lines: what cost the most, and the change that would save the most.>

## Findings

### 1. <The friction, in one line>

- **Cost**: <loops taken, times a person stepped in, sessions lost, time waited>
- **Evidence**: `runs/02-invite-form/receipts/0014-reject.json` (comment: "…"), `runs/03-invite-list/receipts/0009-reject.json`
- **Change**: <the one change: rule text, key and value, or command>
- **File**: `<path>`

### 2. …

## Went well

<One or two lines, or leave the section out.>
```

Done when every unit's record is read, every finding has its evidence and one change with its file, and `retro.md` is written. Tell the person its path and the top three changes; they decide which to apply.
