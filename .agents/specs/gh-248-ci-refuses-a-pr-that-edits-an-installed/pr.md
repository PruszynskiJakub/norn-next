## Summary

The CI process check now refuses a story or bypass PR that edits the installed skill copies `.agents/skills/norn*` unless it is a release PR, and points the author at `packages/cli/assets/skills/`. The unit's skills-drift inbox hint now names both causes: a stale base, or this branch's own edit.

```diff
 processCheck(pr)
   if author is Dependabot: pass
   origin = rules (a) story branch / (b) bypass
   if origin refused: refuse
+  copies = pr.files matching .agents/skills/norn*      # every page, renames by both names
+  if copies and title is not "Release X.Y.Z"
+    refuse "edit packages/cli/assets/skills/ instead and revert .agents/skills/"
   pass
```

## Evidence

No QA ran; the entries are tests (the test check passed; review ran 1288 pass, 0 fail, tsc clean).

- **Process check refuses edits to the installed copies outside a release**
  **Before:** a story PR editing `.agents/skills/norn-review/SKILL.md` passed (as #270 did).
  **After:** `test/repo/process-check.test.ts` › "installed bundled skill copies": story PR with the copy → `ok: false`, `do_instead` names `packages/cli/assets/skills/`; bypass PR → refused; `Release 0.25.0` from a story branch and `Release 0.27.0` from a bypass → pass; `release`/`issue` skills and look-alike paths → pass; title "Fix the Release 0.25.0 notes" → refused.
- **The check sees every changed file**
  **Before:** the check read no file list.
  **After:** "reads every page of the PR's changed files, renames by both names": two pages from `gh api --paginate --slurp` → `files` = `[a.ts, b.ts, .agents/skills/norn-qa/SKILL.md]` (old name of a rename) → refused. `gh pr view --json files` would stop at 100.
- **Drift hint names both causes**
  **Before:** "…runs use this worktree's copies until the base is merged in".
  **After:** "…until the base is merged in, or until this branch's edit to them is reverted", pinned in `packages/core/test/unit/skills-drift.test.ts` › "drifted skills in the inbox", `skills-drift-hold.test.ts` and `test/e2e/base-sync.test.ts`.

Not shown live: `pull_request_target` runs the base's script, so the rule only applies after this merges. A read-only dry run against history: release PRs #272, #243, #217 pass; story PR #270 is refused.

## Merge danger

**Door:** two-way: a revert restores the old check and hint text; nothing persisted changes.

**Blast radius:** CI: a release PR not titled exactly `Release X.Y.Z` (a suffix like `-rc.1` is allowed) would be refused until retitled; the check now makes one more `gh api` call per PR, so it fails, with a re-run hint, if that read fails.
