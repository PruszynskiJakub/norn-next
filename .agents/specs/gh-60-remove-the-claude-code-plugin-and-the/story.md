---
id: gh-60
slug: remove-the-claude-code-plugin-and-the
provider: gh
number: 60
url: https://github.com/PruszynskiJakub/norn-next/issues/60
title: Remove the Claude Code plugin and the sync:plugin release step
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:quick
workflow: quick
status: done
intake_at: 2026-10-28T13:42:03.724Z
body_hash: 33260c590eb50d043b27bedc68ad631ada67a787e89e8cd33f017243bc55e391
merge:
  pr: 84
  url: https://github.com/PruszynskiJakub/norn-next/pull/84
  head_sha: 01c932fd9e3c69c46632dc3a9f1d3765560c8aa1
  merge_commit_sha: 4c3277d61bc7e3f9409ef4fe6c1183f9bce5e83b
  merged_by: PruszynskiJakub
  merged_at: 2026-10-28T15:55:41.000Z
---

We no longer want to expose the Claude Code plugin (`/norn` command). With it gone, `bun run sync:plugin` / `check:plugin` have nothing to do: they only keep `plugins/claude-code/.claude-plugin/plugin.json`'s version equal to `@norn/cli`'s and refuse a `skills/` folder there. The Herdr plugin is unaffected (it carries its own version in `plugins/herdr/herdr-plugin.toml`).

Agents still start the same way without the plugin: "Use the norn skill, then run `norn brief`" — `norn init` already links the skills into `.claude/skills/` (SK1).

## Remove

- [ ] `plugins/claude-code/`
- [ ] `plugins/.claude-plugin/marketplace.json`
- [ ] `scripts/sync-plugin.ts` and `scripts/sync-plugin.test.ts`
- [ ] `sync:plugin` and `check:plugin` scripts in the root `package.json`

## Update

- [ ] `AGENTS.md`: drop "run `bun run sync:plugin` (the Claude Code plugin carries the same version)" from the release steps
- [ ] `README.md`: remove the Claude Code plugin section (install via `claude plugin marketplace add` / `claude plugin install norn@norn`) and the "(or type `/norn` with the Claude Code plugin)" aside; fix the layout lines for `plugins/` and `scripts/` and the dev commands that mention the plugin sync
- [ ] `CHANGELOG.md`: `[Unreleased]` entry noting the Claude Code plugin was removed (existing marketplace installs stop updating)

## Done when

`bun test`, `bun run typecheck` and `bun run schema:emit` pass, and nothing in the repo references `sync-plugin`, `sync:plugin`, `check:plugin` or `plugins/claude-code`.
