## Summary

An agent step can now declare what an outcome must hand back. `norn done` refuses a report that leaves it out, so a review can no longer send work back to `implement` with an empty Rework. The shipped workflows require findings on `review.changes_requested`, `resolution-review.changes_requested` and `qa.fail`.

```diff
 review:
   skills: [norn-review]
+  hand_back: { changes_requested: findings }   # or: evidence
   outcomes:
     changes_requested: { to: implement, counter: review_loop }

 norn done <outcome>
+  if step.hand_back[outcome] = findings and --findings is missing or holds []
+    refuse hand_back_required, do_instead: file format + the full command
+  if step.hand_back[outcome] = evidence and --evidence is missing
+    refuse hand_back_required
   check --criteria (unchanged)
```

## Evidence

No QA ran. The entries below are tests. `bun run test` (2075 pass) and `bun run typecheck` were green at review.

- **A step may declare `hand_back`: outcome → `findings` or `evidence`**
  **Before:** no such key. Findings were optional on every outcome.
  **After:** `hand-back.test.ts` › "a map naming outcomes the step reports loads": the `HandBack` schema on `AgentStep` accepts the map.
- **`norn done` without the required flag is refused (`hand_back_required`)**
  **Before:** `norn done changes_requested --handoff "x"` was accepted.
  **After:** `hand-back.test.ts`: findings missing → refused, and `do_instead` names `--findings <file>` and the JSON format. An empty findings file → refused. Evidence missing → refused. Through the CLI: `criteria.test.ts` › "… a fail without findings" asserts exit 3 and the code (integration tier, which runs only in CI, so it was not run locally).
- **The brief's finish line shows the flag**
  **Before:** `norn done fail --criteria <file> --handoff "…"`
  **After:** `norn done fail --criteria <file> --findings <file> --handoff "…"`, shown by `hand-back.test.ts` › "the finish line … shows its flag, beside --criteria".
- **Load refuses a bad `hand_back` key (`unknown_outcome`)**
  **Before:** did not exist.
  **After:** `hand-back.test.ts`: an undeclared outcome → `unknown_outcome`. An overridable route (e.g. `stuck`) → `unknown_outcome`, even when the step declares it.
- **`criteria: required` stays as it is**
  **After:** `criteria.test.ts` (core unit) unchanged and green.
- **The shipped workflows declare it**
  **After:** both copies (`packages/cli/assets/workflows/`, `.agents/workflows/`) of quick, story, slice and shared/base-update changed. The pinned meaning hashes in `assets.test.ts` and `process.test.ts` moved for exactly these lines.

Gap the review accepted: no hash pins `slice.yaml`, so its review `hand_back` is proven only by the diff and by the workflow loading cleanly.

## Merge danger

**Door:** two-way. `hand_back` is a new optional workflow key. A revert drops it, and a workflow that uses it would then fail schema validation until the key is removed.

**Blast radius:** agents at review and qa. A review that reports `changes_requested`, or a qa that reports `fail`, without `--findings` is now refused where it used to pass. The bundled `norn-review` and `norn-qa` skills already write a findings file, so only an agent that skips its skill hits the refusal, and `do_instead` tells it what to run. Units already running keep their pinned copy of the workflow.
