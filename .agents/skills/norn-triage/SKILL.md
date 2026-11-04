---
name: norn-triage
description: Triage one issue — check it still applies on the current base by trying it, add the repro, the affected code (file:line) and the context, judge its kind, risk and priority, and recommend exactly one next move (refinement, quick, reproduce) or closing it, with the reason. Posts the findings as a `## Triage` issue comment, the one place they live, and puts one kind, one risk and one priority label on the issue, never replacing one already there; changes no file. Use when asked to triage an issue, or to check whether an issue is still valid and what should happen to it.
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
- Back every claim about what code or config does with the `file:line` usages that consume it, not only where it is defined. Never infer behaviour from a schema, a type or the docs alone: a key can be defined and documented yet never read. Name any such key as defined but never read.
- Record the exact commands and what you saw. Say plainly when it no longer applies, or when it could not be tried here and why.

Use the `norn-diagnose` loop only when the symptom does not show on the first try; stop at a repro, never at a cause you guessed.

## 3. Write `## Triage`

Write the findings in this shape:

```markdown
## Triage

**Still applies:** yes | no | not checked — <one line, base commit>
**Repro:** <commands and what they print, minimal>
**Affected code:** `path/to/file.ts:123` — <what it does there, read at the usage that consumes it>
**Rules:** <ids or sections of the project's docs it touches; "none" if no doc covers it>
**Context:** <related issues, PRs, earlier decisions; only what changes the decision>

**Kind:** <kind label> — <reason in one line>
**Risk:** <risk label> — <reason in one line>
**Priority:** <priority label> — <reason in one line>

**Recommend:** <refinement | quick | reproduce | close> — <reason in one or two lines>
```

Pick exactly one:

| Recommend | When |
|---|---|
| `refinement` | new behaviour, or a rule to settle or change first: it needs a spec and a plan agreed with a person before anyone builds it |
| `quick` | a refactor, docs, a chore or a small change with no open design question |
| `reproduce` | it is a bug: something that should work does not. It is reproduced and its cause confirmed before anyone fixes it |
| `close` | it no longer applies, is a duplicate, or is out of scope (name the issue, PR or rule that says so) |

Judge one of each set. Your instructions name the label for each value (for example `<prefix>kind:bug`); without them, write the bare value (`bug`) and add no label.

| Set | Pick |
|---|---|
| kind | `bug`: something that should work does not · `feature`: new or changed behaviour for users · `security`: a vulnerability or hardening · `chore`: maintenance (dependencies, tooling, CI, refactors) · `docs`: documentation only |
| risk | how much the change could break: `low` a two-way door with a small blast radius · `medium` a two-way door touching shared code or behaviour · `high` a one-way door (data, formats, public interfaces) or a wide blast radius |
| priority | `low` can wait · `medium` soon, in the normal flow · `high` next: it blocks or hurts work now · `extreme` drop other work (broken main, data loss, a security hole) |

When the issue already carries a label from a set (a person's, or an earlier triage's), keep it: write `**Kind:** <the label there>, kept as set; triage would say <your pick> — <reason>`, and add nothing to that set.

A rule the issue would change is a `refinement`, unless the change is small and settled, then `quick`. A bug you could not make happen is a `close` with what you tried, or a `reproduce` when the report is specific enough that a deeper loop may still catch it.

## 4. Label the issue and post the comment

1. For each set with no label on the issue yet, add the one you picked: `gh issue edit <N> --add-label <label>` (`glab issue update <N> --label <label>` on GitLab). When adding a label fails because the repository does not have it, do not create it: note it for the comment.
2. When a label could not be set, end the `## Triage` section with `Labels not set: <label> is missing on the remote; <what your instructions say creates it>` (one entry per label).
3. Pipe the `## Triage` section into `gh issue comment <N> --body-file -` (`glab issue note <N> --message "$(cat)"` on GitLab); write no temp file in the checkout.

The comment and adding these labels are your only remote writes: never create, edit or delete a label definition, never remove a label from the issue (the one that took the issue in included), never edit the issue body or title, assign or close. On a rerun, post a new comment that starts with `## Triage (updated)`; the labels already on the issue stay, and the comment says where your judgement now differs.

## Rules

- Read-only: you change no file. Later work reads the findings from the issue comment.
- One recommendation, with its reason. Never act on it yourself: a person decides.
- One label per set on the issue, never two: a label already there wins over your judgement, which goes in the comment.

Done when the labels you could set are on the issue and the `## Triage` comment is posted; the recommendation lives there, and you hand back only a one-line summary of it.
