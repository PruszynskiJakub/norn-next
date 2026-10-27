---
name: release-start
description: Start a norn release — check there is something to release, no release is open and main's CI is green, then draft the release issue (labels norn and norn:wf:release) with the person and create it once they confirm. Person-only.
disable-model-invocation: true
argument-hint: "[version] [notes]"
---

# Release start

You open the issue a release runs from; norn takes it from there (the `release` workflow). This is an ad-hoc session: you may only read and create this one issue. Never edit a file, commit, branch, tag or push.

## 1. Check

Run these and stop at the first that fails, saying why and what would fix it:

```sh
git fetch origin --tags
last=$(git describe --tags --abbrev=0 origin/main)
git log --first-parent --oneline "$last"..origin/main                      # must not be empty
gh issue list --label norn:wf:release --state open                         # must be empty
gh run list --workflow ci.yml --branch main --limit 1 --json headSha,status,conclusion
```

The last CI run must be `completed` / `success` on the head of `origin/main` (`git rev-parse origin/main`). One still running: say so and let the person choose to wait. No run on that head (a Dependabot auto-merge starts none): say so and go on with the last run on main; the release workflow runs the full check anyway. Refuse only on a failed run.

Then list what is open, for the person to pick from: `gh pr list --state open --json number,title,isDraft,author`.

## 2. Ask

Show the commits since `$last` and the open PRs, then ask, in one message:

- **Version**: empty means the release step proposes one at the gate. Take one given as an argument.
- **Must include**: open PRs the release waits for.
- **Notes**: anything the changelog must say.

## 3. Draft and confirm

Show the issue exactly as it will be created:

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

Create it only after the person says yes; on any change, show the draft again.

```sh
gh issue create --title Release --label norn --label norn:wf:release --assignee @me --body-file - <<'EOF'
…
EOF
```

## 4. Hand over

Print the issue link and: `norn sync` takes it in now (or the next `norn watch` sync does); the `prepare` step then writes the changelog and proposes the version for the `confirm-version` gate.
