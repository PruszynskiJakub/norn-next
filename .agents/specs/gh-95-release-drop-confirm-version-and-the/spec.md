---
id: gh-95
slug: release-drop-confirm-version-and-the
provider: gh
number: 95
url: https://github.com/PruszynskiJakub/norn-next/issues/95
title: "Release: drop confirm-version and the local test, wait for CI instead"
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:quick
workflow: quick
status: done
intake_at: 2026-10-29T10:58:15.394Z
body_hash: 0f0d33cb12a56d76d251a92c17df473543d4ca9cd3b3fcc5812c4642a292f417
merge:
  pr: 104
  url: https://github.com/PruszynskiJakub/norn-next/pull/104
  head_sha: 2f5077b6d359f270bd78454633811db2872661cc
  merge_commit_sha: 533fb102046fdde00ec5b8d51655f06578fefd9f
  merged_by: PruszynskiJakub
  merged_at: 2026-10-29T14:54:19.000Z
---

## Observed

A release needs three person actions and runs CI twice: `/release-start` → `prepare` (agent) → `confirm-version` (gate) → `test` (check, up to 25 min) → `open-pr` → `ready` (gate) → merge → CI tags and publishes. The local `test` repeats what `release.yml` already does before it pushes a tag: test, build, smoke the bundle and the linux-x64 binary, then smoke every binary on its own OS (macOS arm64/x64, Linux arm64). The tag is pushed only in `publish`, after `build` and `smoke` pass. On gh-89 the local test failed after 387 s and the person had to switch the story by hand.

## Wanted

- Change the flow to `prepare → open-pr → ci → ready`.
- **Drop `confirm-version`.** The version and its reason are in the PR title and body (`Release X.Y.Z`); the person judges them at `ready` or on the PR. A reject at `ready` goes back to `prepare`, as now (`ready_loop`).
- **Drop the local `test`.** Use the `ci` check step from #93, with `fail` → `$stuck` (a red CI on a release means the base is broken, as today).
- **Keep `base: { stale: behind }`:** a commit landing after `prepare` would be missing from the changelog.
- Update the `release` skill (section 1 refers to the gate after it), the workflow header comment and the "To release" paragraph in AGENTS.md.

Depends on the `ci` step from #93.

## Where

- `.agents/norn/workflows/release.yaml` (`confirm-version`, `test`)
- `.github/workflows/release.yml` (`build`, `smoke`, `publish` needs)
- `.agents/skills/release/SKILL.md`, `AGENTS.md` (Commands: "To release")

## PRD

BS7 (stale: behind). No rule changes; repo-local workflow only.
