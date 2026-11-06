## Summary

Reviewers get a short `REVIEW.md` at the repo root: what to skip, what counts as a failure, how to write a finding. The hand-written PR template (used for bypass PRs) now also asks about **Risk** and **How to revert**.

```text
REVIEW.md                          # new: Skip · What counts as a failure · How to write a finding
.github/pull_request_template.md   # + ## Risk, + ## How to revert (after Tested, before Closes #)
```

## Evidence

Docs-only change, checked by reading the files; there is no test or runtime behaviour to observe. `bun run test` (1258 pass) and `bun run typecheck` are green.

- **W1** Skip list
  **Before:** did not exist
  **After:** `REVIEW.md` § Skip lists `packages/schema/json/`, `packages/core/test/golden/`, `test/e2e/transcripts/`, `test/e2e/observe-snapshots/` and `runs/`, each with the command that rewrites it; all the paths exist.
- **W2** What counts as a failure
  **Before:** did not exist
  **After:** `REVIEW.md` § What counts as a failure names a persisted format that breaks old records, a claim or lease race, a write that is not atomic (S1, with P6 and S5), and core reaching for IO.
- **W3** No style nits; every finding cites file and line
  **Before:** did not exist
  **After:** `REVIEW.md` § How to write a finding. One deviation from the issue: it says "the type check and the repo lints in the unit tier own style", not "Biome owns style", because the repo has no Biome (no config, no dependency). Change that line if Biome is meant to arrive.
- **W4** PR template asks about risk and revert
  **Before:** the template asked only What's new and Tested
  **After:** `.github/pull_request_template.md` has `## Risk` and `## How to revert`, each with a prompt comment.

## Merge danger

**Door:** two-way: two Markdown files; reverting the squash commit undoes it completely.

**Blast radius:** none: nothing reads `REVIEW.md` yet (the review skill picks it up once #226 ships); only PRs opened by hand see the new template sections.
