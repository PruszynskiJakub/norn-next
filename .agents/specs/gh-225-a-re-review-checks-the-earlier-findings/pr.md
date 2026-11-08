## Summary

A re-review now checks the previous review's findings first, fixed or not, and `implement` reworks only blocking and major findings; minor and nit findings stay notes instead of costing another round.

```diff
 review step (quick, slice; both workflow copies)
-  inputs: [spec, diff]
+  inputs: [spec, diff, last_findings]

 brief for review#2+
-  "review#1 reported changes_requested … earlier attempts are history"
+  if step declares last_findings and review#1 had findings
+    "First check each earlier finding below: fixed or not"
+    ### Earlier findings (review#1)   ← history.earlier.findings

 brief for implement after changes_requested
-  all findings; "minor and nit ones are for you to weigh"
+  ### Findings       ← blocking + major: "fix each one"
+  ### Notes          ← minor + nit: "do not fix them in this round"
```

The `norn-review` skill gets a new first step (check the earlier findings) and Decide says minor and nit findings are notes, never rework.

## Evidence

No QA ran; the entries are tests in `packages/core/test/unit/brief.test.ts` (on the merged HEAD: unit tier 1291 pass, typecheck clean).

- **Review steps declare `last_findings`, and a re-review checks each earlier finding first**
  **Before:** review#2's brief said earlier findings were history only; Last findings was `none`.
  **After:** "the earlier review's findings are listed to check, fixed or not, and Inputs points at them": `history.earlier.findings == EARLIER`, the JSON Last findings ref → `see Earlier findings`, markdown lists `### Earlier findings (review#1)`. A step without `last_findings` keeps the old text; no earlier findings → `none`.
- **Rework is blocking and major only; minor and nit stay notes**
  **Before:** every finding listed together, "minor and nit ones are for you to weigh".
  **After:** "implement's Rework sorts the findings…": blocking and major under Findings, minor and nit under `### Notes (review: minor and nit)` with "do not fix them in this round". The existing snapshot "rework after review findings lists them" changes accordingly.
- **The `norn-review` skill source**
  **Before:** no step for earlier findings.
  **After:** step 1 checks each earlier finding at its file and line; Decide says minor and nit are notes. Judged by the review reading the skill (no test); `assets.test.ts` keeps it free of norn words.

Not covered here: `story`'s review step does not exist yet; it comes with #227, which should declare `last_findings` too. The review left one note: the skill mentions a `major` severity its own findings format (`blocking | minor | nit`) does not list.

## Merge danger

**Door:** two-way: no schema, receipt or golden change; `history.earlier.findings` is an optional key on the in-memory brief, so a revert removes it cleanly.

**Blast radius:** agent briefs: review and implement agents read different instructions. If wrong, a real minor issue goes unfixed (it is still shown as a note to the person), or a reviewer re-raises a stale finding. Units already running keep their pinned workflow and pick up `last_findings` only in new runs.
