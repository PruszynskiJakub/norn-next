---
name: norn-pr
description: Write a pull request body a reviewer can judge in a minute — a picture of the change, before/after evidence taken from what QA observed, and the merge danger (one-way or two-way door, blast radius) — into the file you are told to write it to. Use when asked to write, describe or rewrite a pull request or merge request body.
---

# PR body

The reviewer reads the body before the diff. Give them the shape of the change, the proof it works, and what could go wrong when it merges, in that order, and nothing else. Write it for the branch as it is now: when you rewrite an earlier body, start over from the current diff.

## 1. Read

- The spec: its Problem, its numbered Behaviour items, its Plan. Use the spec's words for things, never your own synonyms.
- The whole diff against the base.
- What QA observed: the criteria reports (a verdict per criterion, with evidence or a repro) and the evidence files. Take the latest report of the change as a whole, not an earlier one that a later fix superseded.

Never claim what nobody observed. A criterion without evidence goes under Evidence as not shown, with why.

## 2. Write

Write the body as Markdown to the file you were told to write it to, in exactly this shape:

```markdown
## Summary

<one or two sentences: what changes for whom>

<the smallest picture that makes the point>

## Evidence

- **B1** <criterion in a few words>
  **Before:** <what happened before, or "did not exist">
  **After:** <what QA observed, with a link to the evidence>

## Merge danger

**Door:** <one-way or two-way>: <why, in one line>

**Blast radius:** <one or two words>: <who or what notices if this is wrong>
```

Do not add a title, the issue link or a `Closes` line: they are added for you. No preamble, no list of files touched, no restating the spec.

### Summary

Pick one picture, the smallest that shows the point. Use several only when one cannot.

- **Pseudocode** for logic: the branch that is new, not the whole function.
- **Call tree** for control flow:

  ```text
  submitForm
    createSession
      persistPrompt
    navigateToSession
  ```

- **Shallow file tree**, a comment per entry, for a change of where things live.
- **Mermaid** (`sequenceDiagram`, `flowchart`) when several parts talk to each other.
- **`diff` block** of the shape, not of the code, when the point is what changed in a structure that already existed:

  ```diff
   on(save)
  -  write content
  +  if content is unchanged
  +    return cached result
  +  write new content
  ```

Keep only the names a reviewer needs to place the change.

### Evidence

One entry per Behaviour item or acceptance criterion, in spec order.

- A screenshot beats output; output beats a test name. For a visible change, link the before and after screenshots.
- Link evidence files committed on the branch by their full URL on the branch. On GitHub an image renders inline as `![B2 after](https://github.com/<owner>/<repo>/blob/<branch>/<path>?raw=true)`.
- For a test, show what it asserts in a line of pseudocode and that it failed before and passes now.
- A criterion only a person could judge, or that could not be checked: say so and say how to check it. Never dress it up as passed.

### Merge danger

- **Door.** Two-way: a revert undoes it completely (code, UI, a feature behind a flag). One-way: a revert leaves something behind — a migration that drops or rewrites data, a published API or file format others now depend on, deleted files or branches, messages already sent.
- **Blast radius.** Who notices if this is wrong, in one or two words (`none`, `one screen`, `every user`, `API consumers`, `CI`), then the concrete ways it could hurt: layout shift, a breaking change for callers, slower startup, a changed default.

Say low risk when it is low. A reviewer stops reading danger sections that always cry wolf.

## 3. Check

Read the body once as the reviewer: every claim traces to the diff or to evidence, every link points at a file that exists on the branch, and nothing in it is a guess.
