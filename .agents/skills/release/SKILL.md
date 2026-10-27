---
name: release
description: Prepare a norn release on the release story's branch — rebuild the changelog from the squash commits on main since the last tag, propose the version with its reason (or apply the one the person gave), bump packages/cli/package.json, the README release badge and the Claude Code plugin, and rename the release issue to "Release X.Y.Z". Use in the `release` workflow's `prepare` step.
---

# Release: prepare

You write what the release says and which version it is. A person confirms the version at the gate after you; tests, the build and the smoke run come after that. Follow the `norn` skill for the brief and the report; this skill is the craft.

## 1. Inputs

- `story.md`: the release issue's body, with `## Version` (empty: you propose), `## Must include` (PRs to wait for) and `## Notes` (put into the changelog as asked).
- The brief's **Rework** section, if any: the person rejected the version at the gate. A version named there wins over everything; apply it and do not argue it again. Any other point there comes first too.
- Each PR under Must include: `gh pr view <n> --json state`. One not merged → `norn stuck "waiting for #<n> to merge"`.

## 2. Collect the commits

```sh
git fetch origin --tags
last=$(git describe --tags --abbrev=0 origin/main)          # e.g. v0.9.1
git log --first-parent --format='%h%x09%s' "$last"..origin/main
```

Every commit on main is one squashed PR: title `<PR title> (#<pr>)`, body the PR description with `Closes #<issue>`. For each:

1. `gh pr view <pr> --json title,body,author,labels,closingIssuesReferences`.
2. The workflow that delivered it: `workflow:` in the frontmatter of `.agents/specs/gh-<issue>-*/story.md` on `origin/main` (`git show`). The issue's `norn:wf:*` label only picks the first workflow, and a triaged issue was switched after it (W9); use the label only when there is no `story.md`.
3. Its section:

| Workflow | Section |
|---|---|
| `fix` | Fixed |
| `story` | Added; Changed if it alters existing behaviour; Removed if it takes something away |
| `quick`, bypass PR | your call from the diff: a change users notice goes under Changed or Fixed; docs-only, tests, CI and internal refactors are omitted |
| `spec`, `release`, `triage` (closed), dependabot | omitted |

Write the commit → section (or omitted, with why) list under Progress in handoff.md, so the person sees it at the gate.

## 3. Write the changelog

Read the two latest sections of `CHANGELOG.md` first and write the same way: one bullet per change a user notices, in plain sentences, present tense, commands and keys in backticks, PRD ids where a rule changed; sub-bullets when one change has several parts. Several PRs that make one change are one bullet. Never paste PR titles.

Insert `## [X.Y.Z] - <today, YYYY-MM-DD>` above the latest version, with `### Added`, `### Changed`, `### Removed`, `### Fixed` in that order, empty ones left out. Keep the preamble as it is. Never add an `## [Unreleased]` section; remove an empty one left from before. `release.yml` refuses a tag without its `## [X.Y.Z]` section.

## 4. The version

In this order: the version from Rework, else the one in `## Version`, else your proposal. Before 1.0 (see the CHANGELOG preamble): **minor** when anything is Added, Changed or Removed, or the machine contract changes (JSON output, exit codes, persisted formats); else **patch**. Give the reason in one line, naming the entries that decide it.

## 5. Bump

- `version` in `packages/cli/package.json`.
- The README release badge: `badge/release-vX.Y.Z-blue` and its alt text `Release vX.Y.Z`.
- `bun run sync:plugin`, then `bun run check:plugin` must pass.

On a rework with another version, change the section heading and every bump to it; leave no old version behind (`git grep` the old one in these files).

## 6. Rename the issue

`gh issue edit <N> --title "Release X.Y.Z"`. The story mirrors the title (GR8) and the PR takes it, so the squash commit on main reads `Release X.Y.Z`. This is the only remote write this skill allows, an exception to the `norn` skill's rule; never edit the issue body.

## 7. Report

`norn done done --handoff "Propose X.Y.Z: <reason>. <a> Added, <c> Changed, <f> Fixed; omitted #.., #.."`. With a version from the person: `"Apply X.Y.Z (from <Rework | issue>). …"`.

## Rules

- Change only `CHANGELOG.md`, `packages/cli/package.json`, `README.md`, what `sync:plugin` writes, and `pr.md` in the spec folder (the PR body: the version, its reason and the new changelog section).
- Never tag, publish or push: the merge of the release PR does that in CI.
