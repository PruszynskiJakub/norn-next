## Summary

`norn-review` now checks each blocking candidate again before it decides, reads a repo-root `REVIEW.md` (what to ignore, what counts as failure, what not to report), and pins every finding to a file and line with a counted summary. `norn init` writes a starter `REVIEW.md` when the repo has none.

```diff
 norn-review
   1. pin the diff
   2. gather the sources
+     + REVIEW.md at the repo root (overrides the smell baseline; given to both axes)
   3. spec axis ‖ standards axis
+     every finding names its file and line
+  4. verify each blocking candidate (fresh subagent, or re-read the code)
+     drop it if it does not hold or cites an ignored path
+     (a red suite or an UNTRACED row is re-checked, never dropped)
   5. decide
   6. traceability table → handoff
   7. findings JSON
+     file + line required; summary "2 findings, 1 blocking" or "No findings."

 norn init
+  REVIEW.md absent?  write packages/cli/assets/REVIEW.md → review: created
+                     else leave it                       → review: exists
+  commit hint: git add .agents .claude REVIEW.md .gitignore
```

## Evidence

The `quick` workflow has no QA step, so the proof is the tests below (test#2: unit tier, integration tier and type check green).

- **Verify pass** before deciding, dropping a candidate that does not hold
  **Before:** each axis reported once and Decide used what it said.
  **After:** `packages/cli/test/unit/assets.test.ts` › "norn-review reads REVIEW.md, verifies each blocking candidate, and pins every finding to a file and line (gh-226)" asserts `indexOf("**Verify each blocking candidate**") < indexOf("**Decide.**")` and that the skill says "fresh subagent" and "Drop a candidate that does not hold".
- **Reads `REVIEW.md`** for ignored paths, what fails here and what not to report
  **Before:** the standards sources were `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, coding-standard docs and lint config, and nothing else.
  **After:** the same test asserts the skill names `REVIEW.md` at the repo root together with "ignore", "counts as failure" and "not to report".
- **Every finding has a file and line; the summary states the count**
  **Before:** `file` and `line` were optional, and the summary only said whether a finding blocked.
  **After:** the same test asserts "`file` and `line` are required" and the literal `No findings.`.
- **`norn init` writes a starter `REVIEW.md`** only when none exists
  **Before:** did not exist.
  **After:** `packages/cli/test/integration/init-review.test.ts`: on a fresh repo, `init` writes a file equal to `assets/REVIEW.md`, prints `REVIEW.md created` and puts `REVIEW.md` in the `git add` hint, and a second `init --json` reports `review: "exists"`. When the repo already has `# ours\n`, init reports `exists` and leaves the file byte-for-byte unchanged. The e2e `slice-workflow` commit-hint assertion now includes `REVIEW.md`.

These are content checks on the skill's text. Nobody watched a review agent run the new verify pass. That will first show on the next review step after a release refreshes the installed skill copy. This repo's `.agents/skills/norn-review` copy stays as released on purpose.

## Merge danger

**Door:** one-way, but a small one: `norn init` now writes `REVIEW.md` into users' repos. A revert stops new copies, and the files already committed stay where they are. The `review` field in `init --json` is a new key; no existing key changed.

**Blast radius:** new inits, review steps: a repo that runs `norn init` gets a new file at its root and one more path in the commit hint. Reviews may block less, because candidates that do not hold get dropped, and the new verify subagent makes them a little slower. The starter's ignore list covers `**/*.lock`, which misses `package-lock.json`, `pnpm-lock.yaml` and `bun.lockb`. Review flagged this as minor and it is not fixed here.
