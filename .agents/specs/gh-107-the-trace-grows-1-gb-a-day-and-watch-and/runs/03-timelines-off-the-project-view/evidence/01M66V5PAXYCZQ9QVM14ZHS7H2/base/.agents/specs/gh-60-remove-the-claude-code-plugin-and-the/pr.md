## Summary

Removes the Claude Code plugin (the `/norn` command) and the `sync:plugin` / `check:plugin` release step that only kept its version in line with `@norn/cli`. Existing marketplace installs of `norn@norn` stop getting updates. Agents still start the same way, with *"Use the norn skill, then run `norn brief`"*, because `norn init` already links the skills into `.claude/skills/` (SK1). The Herdr plugin is unchanged.

```text
plugins/
  .claude-plugin/marketplace.json     # removed
  claude-code/                        # removed (plugin.json, commands/norn.md)
  herdr/                              # unchanged
scripts/
  sync-plugin.ts, sync-plugin.test.ts # removed
package.json                          # sync:plugin, check:plugin scripts removed
.agents/norn/workflows/release.yaml   # `bun run check:plugin` dropped from the check step
.agents/skills/release/SKILL.md       # no plugin version bump
AGENTS.md, README.md, docs/cookbook.html  # plugin section, /norn aside, layout and dev-command lines updated
```

## Evidence

- **Remove** the plugin, marketplace file, sync script and its test, and the two `package.json` scripts
  **Before:** `plugins/claude-code/`, `plugins/.claude-plugin/marketplace.json`, `scripts/sync-plugin{,.test}.ts`, `sync:plugin` and `check:plugin` existed.
  **After:** all deleted in this diff.
- **Update** AGENTS.md, README.md (and `docs/cookbook.html`, the release skill and `release.yaml`, which also referred to the plugin)
  **Before:** the release steps ran `bun run sync:plugin`; the README had a Claude Code plugin section, a "(or type `/norn` …)" aside and plugin-sync dev commands; `release.yaml` ran `bun run check:plugin`.
  **After:** those references are gone. The person approved the `release.yaml` edit during implement.
- **Update** `CHANGELOG.md` `[Unreleased]` entry: **not done on purpose.** AGENTS.md says PRs never edit `CHANGELOG.md` and there is no `[Unreleased]` section; the `release` step writes the entry from this squash commit. That is why this description says that existing marketplace installs stop updating.
- **Done when** tests, typecheck and schema pass, and nothing references the plugin
  **After:** the `test` check step ran `bun install --frozen-lockfile && bun run test && bun run typecheck`: 1198 pass, 0 fail, exit 0. `bun run schema:emit` passed during implement. `grep -rln 'sync-plugin\|sync:plugin\|check:plugin\|plugins/claude-code'` (outside this story's spec folder) only matches `CHANGELOG.md`, in a past release's entry that stays as history.

## Merge danger

**Door:** two-way: a revert restores the plugin, the script and the docs. Installs that update in the meantime keep the last published plugin.

**Blast radius:** plugin users: anyone who installed `norn@norn` from the marketplace stops getting updates and should use the skill prompt instead. The release workflow no longer runs a plugin check, so the next release must not expect one. Not touched here: PRD X3 still describes the Claude Code plugin with a `/norn` command, which is a follow-up for the `spec` workflow.
