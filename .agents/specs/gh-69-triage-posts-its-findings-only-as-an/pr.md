## Summary

Triage now posts its findings only as a `## Triage` issue comment and changes no file; `story.md` stays as intake wrote it, and the steps that use the findings (triage `confirm`, fix `reproduce`, quick `implement`) read them from the issue comment.

```diff
 triage.explore
-  append "## Triage" to story.md
-  post the same as an issue comment
+  post "## Triage" as an issue comment, and only there (change no file)
 triage.confirm / fix.reproduce / quick.implement
-  read the triage findings in story.md
+  read the latest "## Triage" comment: gh issue view <N> --comments
```

## Evidence

Docs and workflow text only (`.agents/norn/workflows/{triage,fix,quick}.yaml`, `.agents/skills/triage/SKILL.md`); no code changed, so no new test. Nobody ran a triage under the new text yet.

- **Triage writes findings only as an issue comment**
  **Before:** `triage.yaml` explore: "Write the findings … into the body of story.md … and post them as an issue comment"; SKILL.md §3 "Write `## Triage` in `story.md`".
  **After:** explore: "Post the findings … as an issue comment, and only there. … Change no file, story.md included." SKILL.md §3 gives the shape only, §4 posts it.
- **`story.md` stays as intake wrote it / "changes no file"**
  **Before:** SKILL.md Rules: "The only file you change is `story.md`."
  **After:** "Read-only: you change no file but the handoff the `norn` skill keeps current; `story.md` stays as intake wrote it." `grep -n story.md` over the four files now finds only reads of the mirrored issue and these "stays as intake wrote it" lines.
- **`decide` and later steps read the triage from the issue comment**
  **Before:** `confirm` prompt "in story.md (also posted on the issue)"; `fix.yaml` "Start from the triage findings in story.md"; `quick.yaml` "The spec is story.md: the issue and the triage findings".
  **After:** all three point at the issue's latest `## Triage` comment (`gh issue view <N> --comments`). fix and quick were not named in the issue; triage found they read story.md too.
- **Suite stays green**
  **After:** test step: `bun run test && bun run typecheck` → 1200 pass, 0 fail, typecheck clean.

Not changed (review notes, non-blocking): `quick.yaml:45` review's `approve` still means "the change does what story.md asks", without naming the triage comment; `fix.yaml:17` is one long unwrapped line.

## Merge danger

**Door:** two-way: a revert restores the old text; stories triaged meanwhile simply have no `## Triage` in story.md, which the old text tolerates.

**Blast radius:** triage runs: a story triaged before this merge and fixed after it keeps its findings in story.md, not in a `## Triage` comment it may lack; gh-61 and gh-69 both also posted the comment, so in practice the comment exists.
