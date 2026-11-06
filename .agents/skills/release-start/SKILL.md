---
name: release-start
description: Opens the issue that starts a norn release, once there are unreleased commits, no release is open and main's CI is not red. Use when the person runs /release-start. Not for writing the changelog or bumping the version; the `release` skill does that.
disable-model-invocation: true
argument-hint: "[version] [notes]"
---

# Release start

You open the issue a release runs from; the `release` workflow does the rest. This is an ad-hoc session: you may only read and create this one issue. Never edit a file, commit, branch, tag or push.

## 1. Check

Run these and stop at the first that fails, saying why and what would fix it:

```sh
git fetch origin --tags
last=$(git describe --tags --abbrev=0 origin/main)
git log --first-parent --oneline "$last"..origin/main                      # must not be empty
gh issue list --label norn:wf:release --state open                         # must be empty
gh run list --workflow ci.yml --branch main --limit 5 --json headSha,status,conclusion
```

Judge CI by the newest run whose conclusion is not `cancelled` (ci.yml's concurrency group cancels a queued push run when a newer one arrives):

- `completed` / `success` on `git rev-parse origin/main`: go on.
- Still running: say so and let the person choose to wait.
- On an older commit (the head has no run, e.g. a Dependabot auto-merge starts none): say so and go on; the release PR's CI runs every tier anyway.
- `failure`: refuse. Fix main in its own story first.

## 2. Ask

Show the commits since `$last` and the open PRs (`gh pr list --state open --json number,title,isDraft,author`), then ask, in one message:

- **Version**: empty lets the `prepare` step propose one, judged at the `ready` gate. Take one given as an argument.
- **Must include**: open PRs the release waits for. `prepare` goes `$stuck` until each is merged, so an unmerged one means the release waits on it.
- **Notes**: anything the changelog must say.

## 3. Draft and confirm

Show the issue exactly as it will be created. The three headings are read by the `release` skill: keep them, even when empty.

```markdown
Title: Release
Labels: norn, norn:wf:release
Assignee: @me

## Version

<X.Y.Z, or empty>

## Must include

- #<pr> <title>

## Notes

<notes, or empty>
```

Unlike `/issue`, assign it: the release should be taken in now, from today's main (GR1, GR2). Keep the title `Release`; `prepare` renames it to `Release X.Y.Z`.

Create it only after the person says yes; on any change, show the draft again.

```sh
gh issue create --title Release --label norn --label norn:wf:release --assignee @me --body-file - <<'EOF'
…
EOF
```

## 4. Hand over

Print the issue link and: `norn sync` takes it in now (or the next `norn watch` sync does); `prepare` then writes the changelog and proposes the version; norn opens the PR, waits for its CI and stops at the `ready` gate.
