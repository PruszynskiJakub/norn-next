---
name: issue
description: Turn what the person noticed in an ad-hoc session (a bug, an idea, friction with norn) into a norn issue, shown as a draft for their yes and left unassigned. How an ad-hoc session hands work over to norn. Person-only.
disable-model-invocation: true
argument-hint: "[what you noticed]"
---

# Issue

Every change to this repo starts as a norn issue; an ad-hoc session hands work over through this skill. Invoking it lets you read and create this one issue, after the person's yes. Never edit a file, commit, branch, push or assign.

## 1. Gather

From the conversation, the argument, and what you read:

- **Observed**: what happens now, exactly (command, output, file). About norn's behaviour, also the `norn --version` that showed it: the process runs the released binary, and `main` may already differ.
- **Wanted**: what should happen instead, and for whom.
- **Repro**: the shortest steps that show it, if any. To try norn's behaviour, run `bun packages/cli/src/main.ts …` in a throwaway git repo under `$TMPDIR`, never the installed `norn` and never in this checkout or a unit worktree (a dev build there acts on live claims and run state).
- **Where**: `path/to/file.ts:123` for the code involved.
- **Rules**: the ids in `.agents/RULES.md` it touches (`W9`, `GR8`, …), or that none do.

Search for an existing issue first: `gh issue list --state all --search "<words>"`. If an open one covers it, show it and stop unless the person still wants a new one; if a closed one does, link it in the new body. Ask only for what you cannot find, one question at a time.

## 2. Draft and confirm

Show the issue exactly as it will be created:

```markdown
Title: <what is wrong or wanted, in a few words; no prefix>
Labels: norn[, norn:wf:<name>][, friction]
Assignee: none

## Observed

## Wanted

## Repro

## Where

## Rules
```

Leave out a section with nothing in it. Labels:

- `norn`: always; intake takes the issue in once a person assigns it (GR1).
- One `norn:wf:<name>` at most: it picks the first round's workflow (W9). The workflow the person names wins. Otherwise `norn:wf:reproduce` for a bug (norn does something wrong), so it starts in `reproduce`; otherwise none, and `triage` decides. Never `release` (that is `/release-start`) or `slice`.
- `friction`: friction with norn itself (a refusal that made no sense, a step that went in circles, a missing command).

Never assign it, and do not use `norn story create` (it assigns). Intake cuts the story branch from the base the moment norn sees an assigned, labelled issue (GR2), so an issue assigned while it waits in the backlog starts from a base that ages.

A fork PR is input: link it in the body, never ask to merge it as is.

Create it only after the person says yes; on any change, show the draft again.

```sh
gh issue create --title "<title>" --label norn [--label …] --body-file - <<'EOF'
…
EOF
```

## 3. Hand over

Print the issue link and: when work on it should begin, run `norn story take gh-<N>` (it assigns the issue to you); the next sync takes it in, or `norn sync` does it now.
