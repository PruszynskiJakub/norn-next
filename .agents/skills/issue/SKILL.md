---
name: issue
description: Turn what the person noticed in this session (a bug, an idea, friction with norn) into a well-formed norn issue — observed and wanted, a repro, the code location and the PRD ids it touches — and create it once they confirm. How an ad-hoc session hands work over to norn. Person-only.
disable-model-invocation: true
argument-hint: "[what you noticed]"
---

# Issue

Every change to this repo starts as a norn issue. An ad-hoc session never changes the repo itself: it reads, explores, discusses, and hands the work over through this skill. You may only read and create this one issue. Never edit a file, commit, branch or push.

## 1. Gather

From the conversation and the argument, and by reading what you need:

- **Observed**: what happens now, exactly (command, output, file).
- **Wanted**: what should happen instead, and for whom.
- **Repro**: the shortest steps that show it, if there are any. About norn's behaviour, run `bun packages/cli/src/main.ts …` in a throwaway repo, never the installed `norn` against this one.
- **Where**: `path/to/file.ts:123` for the code involved.
- **PRD**: the ids in `.agents/PRD.md` it touches (`W9`, `GR8`, …), or that none do.

Search first for one already open: `gh issue list --state open --search "<words>"`. If one exists, show it and stop unless the person still wants a new one. Ask only for what you cannot find yourself, one question at a time.

## 2. Draft and confirm

Show the issue exactly as it will be created:

```markdown
Title: <what is wrong or wanted, in a few words; no prefix>
Labels: norn[, norn:wf:<name>][, friction]
Assignee: @me

## Observed

## Wanted

## Repro

## Where

## PRD
```

Leave out a section with nothing in it. Labels:

- `norn`: always, so norn takes the issue in.
- `norn:wf:<name>` (`fix`, `quick`, `story`, `spec`): only when the person names the workflow; otherwise the `triage` workflow decides.
- `friction`: when it is friction with norn itself (a refusal that made no sense, a step that went in circles, a missing command).

A fork PR is input: link it in the body, never ask to merge it as is.

Create it only after the person says yes; on any change, show the draft again.

```sh
gh issue create --title "<title>" --label norn [--label …] --assignee @me --body-file - <<'EOF'
…
EOF
```

## 3. Hand over

Print the issue link and: `norn sync` takes it in now (or the next `norn watch` sync does).
