### Goal

Prepare the next norn release: changelog section, version bumps (package.json, README badge, norn_version), refreshed bundled skills, pr.md, issue renamed to "Release X.Y.Z".

### Proof

Nothing written yet: the prepare step stopped before any change.

### Easy to miss

The spec's Must include lists #325 (Simplify norn upgrade: assume every repo starts at 0.30, drop the old migrations); the release must wait for it to merge.

### Not proven yet

Everything: changelog, version, bumps, skill copies, pr.md, issue title.

### Notes

- `gh pr view 325 --json state` on 2026-11-10 returned OPEN, so the step reported stuck as the release skill says.
- Commits on origin/main since v0.30.0 (no sorting done yet): #320, #324, #323, #322, #310, #316, #313, #307, plus norn bookkeeping commits.

### Resume

Once #325 is merged, rerun the prepare step: fetch tags, sort commits since v0.30.0 into sections, write the changelog and bumps per the release skill.
