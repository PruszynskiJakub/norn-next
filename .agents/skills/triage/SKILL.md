---
name: triage
description: Triage one norn issue in this repo — check it still occurs on the current base by running it, add the repro, the affected code (file:line), the PRD ids it touches and the context, and recommend exactly one next workflow (fix, quick, story, spec) or close, with its reason and the command the person runs. Posts its findings as a `## Triage` issue comment, the one place they live; changes no file. Use in the `triage` workflow's `explore` step.
---

# Triage

You turn a fresh issue into a decision a person can take in a minute. You do not fix, plan or spec anything. Follow the `norn` skill for the brief and the report; this skill is the craft.

## 1. Read

- The story's `story.md` (the spec input): the issue as mirrored at intake, its number and URL.
- The issue's comments: `gh issue view <N> --comments`. A fork PR named there is input, never something to merge.
- On a rerun, the brief's Rework section first: the person's reason at the gate is why you run again.

## 2. Check it still occurs

The story worktree is on the current base. Try what the issue describes there.

- About norn's behaviour: run this checkout's code, `bun packages/cli/src/main.ts …` (after `bun install --frozen-lockfile`), never the installed `norn`. Run it in a throwaway git repo under `$TMPDIR`, never in this worktree: it is a live norn unit.
- About code, docs or tests: read them, run the test that covers it (`bun test <path>`).
- Record the exact commands and what you saw. Say plainly when it no longer occurs, or when it could not be tried here and why.

Use `norn-diagnose`'s loop only when the symptom does not show on the first try; stop at a repro, never at a cause you guessed.

## 3. Write `## Triage`

Write the findings in this shape; they go only into the issue comment (section 4), never into `story.md`, which stays as intake wrote it.

```markdown
## Triage

**Still occurs:** yes | no | not checked — <one line, base sha>
**Repro:** <commands and what they print, minimal>
**Affected code:** `path/to/file.ts:123` — <what it does there>
**PRD:** <ids the issue touches, e.g. W9, GR8; "none" if it is outside the PRD>
**Context:** <related issues, PRs, earlier decisions; only what changes the decision>

**Recommend:** <fix | quick | story | spec | close> — <reason in one or two lines>
**Run:** `norn story edit gh-<N> --workflow <workflow> --at <start step>`
```

Pick exactly one:

| Recommend | When | Start step |
|---|---|---|
| `fix` | it is a bug and it occurs | `reproduce` |
| `quick` | a refactor, docs, a chore or a small change with no open design question | `implement` |
| `story` | a feature: new behaviour that needs refining, a plan and slices | `refine` |
| `spec` | the PRD must change or be settled first (new or changed ids); no code | `refine` |
| `close` | it no longer occurs, is a duplicate, or is out of scope (name the issue, PR or PRD id that says so) | — (no `Run:` line; the person closes it at the gate) |

Cite PRD ids exactly as written in `.agents/PRD.md`. A rule the issue would change is a `spec`, not a `fix`.

## 4. Post it as an issue comment

Pipe the `## Triage` section into `gh issue comment <N> --body-file -` (no temp file in the worktree: norn commits what is left). This one comment is the only remote write this skill allows, an exception to the `norn` skill's rule; never edit the issue body or title (norn tracks the body, GR8), never label, assign or close. On a rerun, post a new comment that starts with `## Triage (updated)`.

## 5. Report

Report the recommendation itself as the outcome: `norn done <fix|quick|story|spec|close> --handoff "<reason>; run <command>"`. `norn stuck` only when the environment stops you (no `gh` auth, `bun install` fails); a bug you cannot reproduce is a `close` or a `not checked` with the reason, not a stuck.

## Rules

- Read-only: you change no file but the handoff the `norn` skill keeps current; `story.md` stays as intake wrote it. Later steps read the findings from the issue comment.
- Never run `norn story edit --workflow` yourself: switching is the person's (W9, S7).
