---
name: release
description: Prepares a norn release in the release workflow's prepare step — changelog from the commits since the last tag, the version and its reason, the version bumps and skill copies, pr.md. Not for starting a release; that is /release-start.
---

# Release: prepare

You write what the release says and which version it is. norn then opens the draft PR with your `pr.md` as its body, waits for its CI, and a person judges the version and the changelog at the `ready` gate. Follow the `norn` skill for the brief, the handoff and the report; this skill is the craft.

## 1. Inputs

- `spec.md`: the release issue's body. `## Version` (empty: you propose), `## Must include` (PRs to wait for), `## Notes` (put into the changelog as asked).
- The brief's **Rework**, if any: the person rejected the release at `ready`. A version named there wins over everything; apply it and do not argue it again. Its other points come first too.
- Each PR under Must include: `gh pr view <n> --json state`. One not merged → `norn stuck "waiting for #<n> to merge"`.

## 2. Sort the commits

```sh
git fetch origin --tags
last=$(git describe --tags --abbrev=0 origin/main)          # e.g. v0.9.1
git log --first-parent --format='%h%x09%s' "$last"..origin/main
```

Each commit on main is one squashed PR, `<PR title> (#<pr>)`, whose body says `Closes #<issue>`. For each, `gh pr view <pr> --json title,body,labels,closingIssuesReferences`, then find the workflow that delivered it: `workflow:` in the frontmatter of `.agents/specs/gh-<issue>-*/spec.md` on `origin/main` (`git show`). With no spec file, use the issue's `norn:wf:*` label. Always check for `norn:wf:reproduce` (`gh issue view <issue> --json labels`): a bug's fix is delivered by `quick`, so its spec says `quick`, but it is Fixed.

| Commit | Section |
|---|---|
| issue labelled `norn:wf:reproduce` | Fixed |
| `story` | Added; Changed if it alters existing behaviour; Removed if it takes something away |
| `quick`, bypass PR | your call from the diff: a change users notice goes under Changed or Fixed; docs-only, tests, CI and internal refactors are omitted |
| `release`, `triage` (closed), Dependabot, `norn: gh-N done (PR merged)` (norn's bookkeeping, no PR) | omitted |

Write the commit → section (or omitted, with why) list under Progress in the handoff, so the person sees it at `ready`.

## 3. Write the changelog

Read the two latest sections of `CHANGELOG.md` and write the same way: one bullet per change a user notices, in plain sentences, present tense, commands and keys in backticks, rule ids where a rule changed; sub-bullets when one change has several parts. Several PRs that make one change are one bullet. Never paste PR titles.

Insert `## [X.Y.Z] - <today, YYYY-MM-DD>` above the latest version, with `### Added`, `### Changed`, `### Removed`, `### Fixed` in that order, empty ones left out. Keep the preamble. Never add an `## [Unreleased]` section; remove an empty one. `release.yml` refuses to tag a version without its `## [X.Y.Z]` section.

## 4. The version

The version from Rework, else the one in `## Version`, else your proposal. Before 1.0: **minor** when anything is Added, Changed or Removed, or the machine contract changes (JSON output, exit codes, persisted formats); else **patch**. Give the reason in one line, naming the entries that decide it.

## 5. Bump

- `version` in `packages/cli/package.json`.
- The README release badge: `badge/release-vX.Y.Z-blue` and its alt text `Release vX.Y.Z`.
- `norn_version: X.Y.Z` in `.agents/norn.config.yaml`: edit the line in place so the comments stay. Once the PR merges, `main` asks for exactly the binary it publishes (gh-61 B27).

Edit by hand, never with `norn upgrade` (gh-61 D13): it runs only in the main checkout, and the norn running this step is the release before this one.

## 6. Refresh the bundled skills

`.agents/skills/norn*` are copies of `packages/cli/assets/skills/norn*` and must match them in the same diff as the bump (B27). From the worktree root:

```sh
for src in packages/cli/assets/skills/norn*/; do
  name=$(basename "$src")
  rm -rf ".agents/skills/$name" && cp -R "$src" ".agents/skills/$name"
  [ -e ".claude/skills/$name" ] || ln -s "../../.agents/skills/$name" ".claude/skills/$name"
done
for dst in .agents/skills/norn*/; do
  [ -d "packages/cli/assets/skills/$(basename "$dst")" ] || echo "no longer bundled: $dst"
done
git status --short .agents/skills .claude/skills
```

Only `norn`-prefixed folders: `release`, `release-start` and `issue` are this repo's own. A folder the second loop names is no longer bundled: remove it and its `.claude/skills/` link. Name the skills that changed in the handoff (none is fine).

## 7. Write pr.md

`pr.md` in the spec folder is the PR body: `## Release X.Y.Z`, the version with its reason (or where it came from), and the new changelog section. norn adds the issue link.

## 8. Rename the issue

`gh issue edit <N> --title "Release X.Y.Z"`. The story mirrors the title (GR8), and the squash commit on main takes the PR's title. This is the one remote write this step allows, an exception to the `norn` skill's rule; never edit the issue body.

## 9. Report

`norn done done --handoff "Propose X.Y.Z: <reason>. <a> Added, <c> Changed, <f> Fixed; omitted #.., #.."`, or `"Apply X.Y.Z (from <Rework | issue>). …"` for a version the person gave.

## Rework with another version

Change the section heading, the three bumps, `pr.md` and the issue title to it; `git grep` the old version in those files so none is left.

## Rules

- Change only `CHANGELOG.md`, `packages/cli/package.json`, `README.md`, the `norn_version` line of `.agents/norn.config.yaml`, the `norn*` folders of `.agents/skills/` and their `.claude/skills/` links, and, in the spec folder, `pr.md` and the handoff.
- Never tag, publish or push: merging the release PR does that in CI.
