## Summary

GR8's "issue body changed since refine" inbox item now appears for workflows whose refine step uses the bundled skill `norn-refine` (every shipped workflow). Before, `refineFinished` matched only `skill === "refine"`, so `refined_body_hash` was never recorded and the item never fired. Gap 1 (an edit before refine finishes) is out of scope for this round.

```diff
 refineFinished(unit)
-  some agent step with skill == "refine"
+  some agent step with skill in {"refine", "norn-refine"}
     and (visited twice, or visited once and the cursor has left it)
```

## Evidence

- **Scope: `refineFinished` matches `norn-refine`**
  **Before:** a story unit past a `norn-refine` step got `slices.wait`; no `refined_body_hash` was recorded.
  **After:** `packages/core/test/unit/decide.test.ts` › "GR8 (gh-73): a refine step on the bundled skill `norn-refine` records refined_body_hash too" asserts `update_story_mirror` with rule `remote.mirror.refined` and `refined_body_hash: sha256(body)`. It failed with `slices.wait` before the fix and passes now.
- **Scope: hash kept across later rounds; a body change still surfaces**
  **Before:** never reached, since the hash was never recorded.
  **After:** same test: on a later round whose workflow has no refine step, with `refined_body_hash` in the frontmatter and a new issue body, decide emits `update_story_mirror` with the new `body_hash` and notify title "issue body changed since refine". `refined_body_hash` is only written when unset, so it stays in spec.md once recorded.
- **Wanted (after refine): the GR8 inbox item appears for the bundled skill**
  Covered by the test above at the decide level (`bodyChangedItem` reads the recorded hash). Not shown end to end: no QA ran against a real issue edit. To check: run a story through `refinement`, edit the issue body, `norn sync`, and look for the item in `norn status`.
- **Wanted (before refine) / Gap 1**
  Not in this round; to be filed as its own issue.

## Merge danger

**Door:** two-way: a pure decide change; a revert restores the old match. A `refined_body_hash` already written to a spec.md stays behind, but it is just a frontmatter field the old code ignores unless it also records one.

**Blast radius:** inbox: stories already past a `norn-refine` step will now record `refined_body_hash` on their next tick (one extra `update_story_mirror` commit each), taking the issue body as it is then; a later edit raises one "issue body changed since refine" item. The golden corpus is unchanged (its fixture still uses `skill: "refine"`).
