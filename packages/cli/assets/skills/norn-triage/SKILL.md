---
name: norn-triage
description: Triages one issue — tries it on the current base, then posts a `## Triage` comment with the repro, the affected code, kind, risk and priority labels, and one recommended next move or closing it. Use when asked to triage an issue or check whether it still applies.
---

# Triage

You turn a fresh issue into a decision a person can take in a minute. You do not fix, plan or write a spec, and you change no file. You read, try, and recommend.

## 1. Read

- The issue: its title, body, number and URL, and its comments (`gh issue view <N> --comments`, `glab issue view <N> --comments`). A fork PR or a patch named there is input, never something to merge or apply.
- On a rerun, the reason you were given first: it says why you look again.
- The project's own docs that state its rules (a README, a contributor guide, a spec or requirements document). Note the rule ids, sections or files the issue touches.

## 2. Check it still applies

You work on the current base. Try what the issue describes there.

- About behaviour: run it the way a user would (the command, the request, the page), from this checkout's code, never from an installed release. Run it somewhere disposable (a throwaway directory or repository), never somewhere your run could change real state.
- About code, docs or tests: read them, and run the test that covers it.
- Back every claim about what code or config does with the `file:line` usages that consume it, not only where it is defined. Never infer behaviour from a schema, a type or the docs alone: a key can be defined and documented yet never read. Name any such key as defined but never read.
- Record the exact commands and what you saw. When you only read the code and did not run it, say so and why.

Use the `norn-diagnose` loop only when the symptom does not show on the first try; stop at a repro, never at a cause you guessed.

## 3. Write `## Triage`

```markdown
## Triage

**Still applies:** yes | no | not checked — <ran it | read only: why>, <base commit>
**Repro:** <commands and what they print, minimal>
**Affected code:** `path/to/file.ts:123` — <what it does there, read at the usage that consumes it>
**Rules:** <ids or sections of the project's docs it touches; "none" if no doc covers it>
**Context:** <related issues, PRs, earlier decisions; only what changes the decision>

**Kind:** <kind label> — <reason in one line>
**Risk:** <risk label> — <reason in one line>
**Priority:** <priority label> — <reason in one line>

**Recommend:** <refinement | quick | reproduce | close> — <reason in one or two lines>
```

Recommend exactly one, and never act on it yourself: a person decides.

| Recommend | When |
|---|---|
| `refinement` | new behaviour, or a rule to settle or change first: it needs a spec and a plan agreed with a person before anyone builds it |
| `quick` | a refactor, docs, a chore or a small change with no open design question; also a rule change that is small and settled |
| `reproduce` | it is a bug: something that should work does not. Its cause is confirmed before anyone fixes it, even when your repro already shows the symptom; a specific report you could not make happen may still go here |
| `close` | it no longer applies, is a duplicate, or is out of scope (name the issue, PR or rule that says so); a bug you could not make happen, with what you tried |

Judge one of each set. Your instructions name the label for each value (for example `<prefix>kind:bug`); without them, write the bare value (`bug`) and add no label.

| Set | Pick |
|---|---|
| kind | `bug`: something that should work does not · `feature`: new or changed behaviour for users · `security`: a vulnerability or hardening · `chore`: maintenance (dependencies, tooling, CI, refactors) · `docs`: documentation only |
| risk | how much the change could break: `low` a two-way door with a small blast radius · `medium` a two-way door touching shared code or behaviour · `high` a one-way door (data, formats, public interfaces) or a wide blast radius |
| priority | `low` can wait · `medium` soon, in the normal flow · `high` next: it blocks or hurts work now · `extreme` drop other work (broken main, data loss, a security hole) |

When the issue already carries a label from a set (a person's, or an earlier triage's), it wins: write `**Kind:** <the label there>, kept as set; triage would say <your pick> — <reason>`, and add nothing to that set. The issue never carries two labels from one set.

## 4. Label the issue and post the comment

Post only when your instructions say to or the person asked you to triage the issue. Asked only whether an issue still applies, show the section and offer to post it.

1. For each set with no label on the issue yet, add the one you picked: `gh issue edit <N> --add-label <label>` (`glab issue update <N> --label <label>` on GitLab). When adding a label fails because the repository does not have it, do not create it: note it for the comment.
2. When a label could not be set, end the `## Triage` section with `Labels not set: <label> is missing on the remote; <what your instructions say creates it>` (one entry per label).
3. Pipe the `## Triage` section into `gh issue comment <N> --body-file -` (`glab issue note <N> --message "$(cat)"` on GitLab); write no temp file in the checkout.

The comment and adding these labels are your only remote writes: never create, edit or delete a label definition, never remove a label from the issue (the one that took the issue in included), never edit the issue body or title, assign or close. On a rerun, post a new comment that starts with `## Triage (updated)`; the labels already on the issue stay, and the comment says where your judgement now differs.

Done when the labels you could set are on the issue and the comment is posted. The comment is the one place the findings live; hand back only a one-line summary of the recommendation.
