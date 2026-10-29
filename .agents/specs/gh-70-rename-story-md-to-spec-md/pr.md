## Summary

Intake now writes a story's spec file as `spec.md` instead of `story.md`. A spec folder an older norn wrote, holding only `story.md`, keeps working: every reader and writer prefers `spec.md`, falls back to `story.md`, and never renames it (design (a), the person's answer to the compatibility question).

```diff
 storyFile(specDir)                       # store paths.ts — every reader and writer
-  return specDir/story.md
+  if specDir/spec.md exists or specDir/story.md does not
+    return specDir/spec.md
+  return specDir/story.md                # GR2: a folder an older norn intook
```

The places that hardcoded the name now go through `storyFile` or check both names: decide intake (`story_file` is `<spec dir>/spec.md`), act intake (skips writing when either file exists), `brief`, `agent-unit` (story criteria), and the GR6 done record on the base (`record.ts` looks for `spec.md`, then `story.md`, in the base tree). PRD GR2 (the legacy rule), W9, the §7 layout and the skills table, README, the bundled `story.yaml` and `norn-retro` skill, and the repo-local `release` skill now say `spec.md`.

## Evidence

No QA step ran on this branch (`quick` workflow). The evidence is the test suite: the `test` check ran `bun run test && bun run typecheck` and passed with 1204 tests, 0 failures, typecheck clean.

- **Intake writes `spec.md`**
  **Before:** decide's `intake_story` action wrote `.agents/specs/<id>-<slug>/story.md`.
  **After:** `decide.test.ts` (intake and start, GR2): `story_file == ".agents/specs/gh-5-fix-lodz-bug/spec.md"`. The e2e, audit, human, criteria, team and records cli tests now assert `spec.md`.
- **Every reader uses `spec.md`**
  **Before:** `storyFile` returned `story.md`, and four call sites hardcoded the name.
  **After:** [`snapshot.test.ts`](https://github.com/PruszynskiJakub/norn-next/blob/gh-70-rename-story-md-to-spec-md/packages/store/test/snapshot.test.ts): a new folder resolves to `spec.md`. A folder with neither file reports `spec.md missing` (S2).
- **Folders that already hold `story.md` keep working (read both names, no migration)**
  **Before:** did not exist (only one name).
  **After:** `snapshot.test.ts`: a folder holding only `story.md` resolves to it and loads with no frontmatter error. When both exist, `spec.md` wins. [`housekeeping.test.ts`](https://github.com/PruszynskiJakub/norn-next/blob/gh-70-rename-story-md-to-spec-md/packages/cli/test/housekeeping.test.ts) (GR6): a merged legacy story is marked done in its `story.md` on the base. A story intaken as `spec.md` is marked done in `spec.md`, and no `story.md` appears.
- **Golden cases and transcripts**
  **After:** the two `base-sync` golden cases and the three effect transcripts were rewritten. Their only change is `story.md` → `spec.md` in paths.

## Merge danger

**Door:** one-way, once a release ships it: stories intaken from then on hold only `spec.md`. A norn without this change (an older release, or this change reverted) reads such a folder as `story.md missing` and marks the unit corrupt (S2). A plain code revert is two-way only until the release.

**Blast radius:** mixed-version collaborators. Anyone still on an older norn sees a newly intaken story as corrupt until they upgrade. Existing `story.md` folders are untouched. Not changed on purpose, as a follow-up after the release: this repo's own `.agents/norn/workflows/*.yaml` and the `triage` skill still say `story.md`, because the released norn that self-hosts this repo still writes `story.md`. Once a release with this change runs here, the `triage` step would be pointed at a `story.md` that does not exist, so switch those right after it ships. The corrupt inbox item id is now `corrupt:<story>:spec.md`, so an inbox-history entry under the old id shows once more.
