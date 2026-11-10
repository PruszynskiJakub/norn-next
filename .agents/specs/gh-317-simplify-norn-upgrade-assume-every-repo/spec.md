---
id: gh-317
slug: simplify-norn-upgrade-assume-every-repo
provider: gh
number: 317
url: https://github.com/PruszynskiJakub/norn-next/issues/317
title: "Simplify norn upgrade: assume every repo starts at 0.30, drop the old migrations"
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:refinement
workflow: refinement
status: active
intake_at: 2026-11-10T08:21:19.336Z
body_hash: 5bf58336d1c9038bb879d6431fa0d4f75f80ac49128eb44e1683f8c653a648df
---

## Why

`norn upgrade` still carries every migration since the old layout: moving `.agents/norn/{config.yaml,workflows,trace}`, old config keys to new ones, stripping criteria `needs`, run state in the base's tree to archive refs, and the `.gitattributes` line. Each one is code, tests and guards spread across the CLI that every repo already on 0.30 never runs again. That code is also where bugs hide: #314 (upgrade crashing on a file in `.agents/specs/`) was in the `needs` strip.

## Wanted

Every repo is assumed to start at norn 0.30.x. `norn upgrade` only moves a repo between versions from 0.30 on:

- refuses a binary older than the repo (as today);
- rewrites the bundled skills and relinks them into each agent's skill folder;
- writes `norn_version` last; stages everything, commits nothing;
- creates missing labels.

A repo whose `norn_version` is below 0.30 (or missing, on the old layout) is refused with a clear `do_instead`: install norn 0.30.x, run `norn upgrade`, commit, then upgrade again. No guessing at an old repo's shape.

## What goes (a first map, to be confirmed in refinement)

- Old layout: `packages/store/src/old-layout.ts`, `layout.ts`, the `OLD_*` paths and `oldTickLockPath` in `paths.ts`, `moveLayout`/`refuseBoth`/the old-lock branch in `upgrade.ts`.
- Old-layout guards elsewhere: `guardLayout` at `Context.locate()`, the `layout` command field and `checksLayout`, `packages/cli/src/runtime/layout.ts`, doctor's layout section, the layout check in `hook.ts`.
- Config key migration: `packages/store/src/config-migrate.ts` and `migrateConfigPart`.
- Base-tree run state: `archiveBaseRunState` (`record-ref.ts`), `record-move.ts`, `dropRunsAttribute`, doctor's `baseRunStateStories`, `runStatePart`.
- The deprecated `norn migrate` alias (already due for removal).
- Their tests (`upgrade.test.ts` layout/config parts, `upgrade-records.test.ts`, `layout.test.ts`, `layout-guard.test.ts`, `run-state-move.test.ts`, parts of `hook-run-state-writes.test.ts`) and the docs that describe the old layout or `migrate`.

## Open questions

1. `packages/store/src/snapshot.ts` reads run state in a story branch's tree (`branch_record`, `treeRunStateFiles`). Is that only for branches an older norn left, so it goes too, or does a live 0.30 path still depend on it?
2. Below-0.30 refusal: in the version guard for every command that acts, in `upgrade` only, or both?
3. Does doctor keep any old-layout hint, or does it simply see an unknown repo?

## Before it lands

0.30.0 crashes upgrading a repo with a file in `.agents/specs/`; the fix (#316) must be released (0.30.1) first, so "start at 0.30.x" is reachable without moving files by hand.
