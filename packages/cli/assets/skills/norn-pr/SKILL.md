---
name: norn-pr
description: Writes a story's pull request body — the smallest picture of the change, before/after evidence per criterion, and the merge danger — to the file you are told to write it to. Use when asked to write, describe or rewrite a pull request or merge request body.
---

# PR body

The reviewer reads the body before the diff and should be able to judge it in a minute. Without this skill a body lists files, restates the spec and grows to pages. Give the shape of the change, the proof it works, and what could go wrong when it merges, in that order, and nothing else.

Write for the branch as it is now. Each time the PR is opened or updated its body is replaced with this file, so when you rewrite an earlier body, start over from the current diff, and never edit the body on the remote (`gh pr edit`, `glab mr update`): the next update overwrites it.

## 1. Read

- The spec: its Problem Statement, numbered User Stories and Plan. Use the spec's words for things, never your own synonyms.
- The whole diff against the base.
- The proof, from the strongest source the round has:
  - **QA ran** (you are given criteria reports and evidence folders): the latest criteria report of the change as a whole, not an earlier one a later fix superseded, and the evidence files it names.
  - **No QA** (none given): the tests in the diff, the handoff's Progress (the review's traceability table, the implementer's note on what went red first), and the test check that passed. Say once, at the top of Evidence, that no QA ran and the entries are tests.

Never claim what nobody observed.

## 2. Write

Write the body as Markdown to the file you were told to write it to, in exactly this shape:

```markdown
## Summary

<one or two sentences: what changes for whom>

<the smallest picture that makes the point>

## Evidence

- **<what the user story says, in a few words>**
  **Before:** <what happened before, or "did not exist">
  **After:** <what was observed, with a link to the evidence>

## Merge danger

**Door:** <one-way or two-way>: <why, in one line>

**Blast radius:** <one or two words>: <who or what notices if this is wrong>
```

Do not add a title, the issue link or a `Closes` line: they are added under the body for you. No preamble, no list of files touched, no restating the spec.

### Summary

Pick one picture, the smallest that shows the point. Use several only when one cannot.

- **Pseudocode** for logic: the branch that is new, not the whole function.
- **Call tree** for control flow.
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

One entry per user story, in spec order, each at most three lines, headed by what the story says in a few words, never by a number. A spec without user stories (an issue mirrored as it was filed) gets one entry per point of its Wanted section, headed the same way.

- A screenshot beats output; output beats a test name. For a visible change, link the before and after screenshots.
- Link an evidence file by its path in the story's record, `evidence/<unit>/<run_id>/<file>`, where `<unit>` is `_story` or the slice's `<nn>-<slug>`: `![open-cards warning, after](evidence/01-parser/01ABC/shot.png)`. You are told where each unit's evidence folders are. The evidence is not on the branch: when the PR is opened or updated, each such link is rewritten to the file's URL in the pushed record, where an image renders inline. Never link evidence by a local path or a branch URL. With no evidence folders given, link none.
- For a test, name it and show what it asserts in one line of pseudocode, and that it failed before and passes now. Do not paste the test's setup.
- A criterion that was not shown, that only a person could judge, or that could not be checked: say so, and say how to check it. Never dress it up as passed. Gaps the review accepted go in one line after the entries.

### Merge danger

- **Door.** Two-way: a revert undoes it completely (code, UI, a feature behind a flag). One-way: a revert leaves something behind — a migration that drops or rewrites data, a published API or file format others now depend on, deleted files or branches, messages already sent.
- **Blast radius.** Who notices if this is wrong, in one or two words (`none`, `one screen`, `every user`, `API consumers`, `CI`), then the concrete ways it could hurt: layout shift, a breaking change for callers, slower startup, a changed default.

Say low risk when it is low. A reviewer stops reading danger sections that always cry wolf.

## 3. Check

Read the body once as the reviewer, against the clock: if it takes more than a minute, cut. Every claim traces to the diff or to evidence, every evidence link names a file in a folder you were given, and nothing in it is a guess.
