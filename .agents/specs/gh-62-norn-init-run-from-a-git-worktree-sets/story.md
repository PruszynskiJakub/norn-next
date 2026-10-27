---
id: gh-62
slug: norn-init-run-from-a-git-worktree-sets
provider: gh
number: 62
url: https://github.com/PruszynskiJakub/norn-next/issues/62
title: norn init run from a git worktree sets up the main checkout instead
assignee: PruszynskiJakub
labels:
  - friction
  - norn
workflow: triage
status: active
intake_at: 2026-10-27T22:26:49.689Z
body_hash: 572a5e770f4f1d083db195e44d3b7ad2472be53037a20b180cffd4dcce592071
---

## Observed

Running `norn init` (0.9.1) inside a git worktree (`.claude/worktrees/bootstrap-self-hosting`, branch `bootstrap-self-hosting`) wrote everything into the **main checkout** (`/Users/…/norn`) instead of the worktree:

- `.agents/norn/config.yaml` and `.agents/norn/workflows/*`
- `.agents/skills/norn*` and the `.claude/skills/*` links
- `.claude/settings.json` hooks
- `.gitattributes`
- three lines appended to `.gitignore`

The worktree got nothing. The main checkout's branch, which had its own uncommitted changes, got the new files mixed in with them. The only hint was the header line `norn init in /Users/…/norn`.

`norn doctor` behaves the same way: run in the worktree, it reported hooks and every skill as missing, because it checked the main checkout.

## Repro

```sh
git worktree add ../wt -b try-init origin/main
cd ../wt && norn init
git status --short          # clean
git -C <main checkout> status --short   # norn's files are here
```

## Why

`repoRoot` returns the parent of `git rev-parse --git-common-dir` (`packages/adapters/src/git/index.ts:216-218`), which is always the main checkout. That's right for `tick`, `sync`, `watch` and friends: norn's home is the main checkout, and story worktrees hang off it (A6). But `init` writes files meant to be reviewed and committed on a branch, and preparing that change in a worktree is a natural thing to do.

## Wanted

One of these, for triage to choose:

- `init` writes to the worktree it runs in (the current worktree root, not the common root);
- `init` refuses in a linked worktree, with a `do_instead` naming the main checkout; or
- `init` and `doctor` say plainly that they act on the main checkout, not the current worktree.

## PRD

A6 (`NORN_HOME` is the repo root), SK1 (init copies skills and links them), P8 (`CliError` / `do_instead`).
