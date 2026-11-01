---
name: norn-triage
description: Triage one issue — check it still applies on the current base by trying it, add the repro, the affected code (file:line) and the context, and recommend exactly one next move (refinement, quick, reproduce) or closing it, with the reason. Posts the findings as a `## Triage` issue comment, the one place they live; changes no file. Use when asked to triage an issue, or to check whether an issue is still valid and what should happen to it.
---

# Triage

You turn a fresh issue into a decision a person can take in a minute. You do not fix, plan or write a spec. You read, try, and recommend.

## 1. Read

- The issue: its title, body, number and URL, and its comments (`gh issue view <N> --comments`, `glab issue view <N> --comments`). A fork PR or a patch named there is input, never something to merge or apply.
- On a rerun, the reason you were given first: it says why you look again.
- The project's own docs that state its rules (a README, a contributor guide, a spec or requirements document). Note the rule ids, sections or files the issue touches.

## 2. Check it still applies

You work on the current base. Try what the issue describes there.

- About behaviour: run it the way a user would (the command, the request, the page), from this checkout's code, never from an installed release. Run it somewhere disposable (a throwaway directory or repository), never somewhere your run could change real state.
- About code, docs or tests: read them, and run the test that covers it.
- Record the exact commands and what you saw. Say plainly when it no longer applies, or when it could not be tried here and why.

Use the `norn-diagnose` loop only when the symptom does not show on the first try; stop at a repro, never at a cause you guessed.

## 3. Write `## Triage`

Write the findings in this shape:

```markdown
## Triage

**Still applies:** yes | no | not checked — <one line, base commit>
**Repro:** <commands and what they print, minimal>
**Affected code:** `path/to/file.ts:123` — <what it does there>
**Rules:** <ids or sections of the project's docs it touches; "none" if no doc covers it>
**Context:** <related issues, PRs, earlier decisions; only what changes the decision>

**Recommend:** <refinement | quick | reproduce | close> — <reason in one or two lines>
```

Pick exactly one:

| Recommend | When |
|---|---|
| `refinement` | new behaviour, or a rule to settle or change first: it needs a spec and a plan agreed with a person before anyone builds it |
| `quick` | a refactor, docs, a chore or a small change with no open design question |
| `reproduce` | it is a bug: something that should work does not. It is reproduced and its cause confirmed before anyone fixes it |
| `close` | it no longer applies, is a duplicate, or is out of scope (name the issue, PR or rule that says so) |

A rule the issue would change is a `refinement`, unless the change is small and settled, then `quick`. A bug you could not make happen is a `close` with what you tried, or a `reproduce` when the report is specific enough that a deeper loop may still catch it.

## 4. Post it as an issue comment

Pipe the `## Triage` section into `gh issue comment <N> --body-file -` (`glab issue note <N> --message "$(cat)"` on GitLab); write no temp file in the checkout. This one comment is your only remote write: never edit the issue body or title, never label, assign or close. On a rerun, post a new comment that starts with `## Triage (updated)`.

## Rules

- Read-only: you change no file. Later work reads the findings from the issue comment.
- One recommendation, with its reason. Never act on it yourself: a person decides.

Done when the `## Triage` comment is posted and you hand back the recommendation and its reason in one line.
