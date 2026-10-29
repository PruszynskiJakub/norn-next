# B70 persisted formats: diff origin/main...HEAD over packages/schema/src (HEAD 42880452)
 packages/schema/json/local-cockpit.schema.json |  2 +-
 packages/schema/json/local-inbox.schema.json   |  2 +-
 packages/schema/json/local-notices.schema.json | 14 +++++++++++
 packages/schema/src/config.ts                  | 32 ++++++++++++++++++++++++++
 packages/schema/src/ids.ts                     |  2 +-
 packages/schema/src/local.ts                   |  9 ++++++--
 packages/schema/src/receipt.ts                 | 10 ++++----
 packages/schema/src/state.ts                   |  2 +-
 packages/schema/src/trace.ts                   | 12 +++++-----
 packages/schema/src/validate.ts                |  2 ++
 packages/schema/src/workflow.ts                |  4 ++--
 11 files changed, 72 insertions(+), 19 deletions(-)

receipt.ts / state.ts / trace.ts / workflow.ts: comment lines only:
-   * R6.2/R6.3: `norn answer` already typed the keystrokes into the agent's pane before writing this
+   * R6.2/R6.3: `norn story answer` already typed the keystrokes into the agent's pane before writing this
- * R10.1 (M8): a `norn take` of the story, forced or not, recorded on the story unit. Informational:
- * applied at any cursor (like `mode`), it moves nothing; `norn trace` / `why` show it.
+ * R10.1 (M8): a `norn story checkout` of the story, forced or not, recorded on the story unit. Informational:
+ * applied at any cursor (like `mode`), it moves nothing; `norn run list` / `why` show it.
- * BS9: `norn update <story>` — a person sends the story unit back to its base-update step (from a
+ * BS9: `norn story update-branch <story>` — a person sends the story unit back to its base-update step (from a
-/** Journaled workflow switch (`norn workflow <unit> <name> --to <step>`, S7). */
+/** Journaled workflow switch (`norn story edit <unit> --workflow <name> --at <step>`, S7). */
- * - stuck: needs `norn unstick` ($stuck, exhausted, remote change, missing step)
+ * - stuck: needs `norn run rerun` ($stuck, exhausted, remote change, missing step)
- * tick's act. `norn inbox --history` pairs them into appeared_at / resolved_at / resolved_by.
+ * tick's act. `norn status --history` pairs them into appeared_at / resolved_at / resolved_by.
-    /** the norn that recorded this tick (`@norn/cli` version); `norn why` labels a replay by another version (O5). Absent on older traces. */
+    /** the norn that recorded this tick (`@norn/cli` version); `norn run view --why` labels a replay by another version (O5). Absent on older traces. */
-    /** Facts snapshot (the `Facts` type of @norn/core); replayed by `norn why` (O5). */
+    /** Facts snapshot (the `Facts` type of @norn/core); replayed by `norn run view --why` (O5). */
-/** R10.1 (M8): a `norn take` of a story, forced or not, with the claim it replaced. */
+/** R10.1 (M8): a `norn story checkout` of a story, forced or not, with the claim it replaced. */
- * decisions (and the receipts they number) in the trace. `norn why` reports a `tick.start` with no
+ * decisions (and the receipts they number) in the trace. `norn run view --why` reports a `tick.start` with no
- * criteria" shows up as data (`norn trace` sums `unverified_needs`). `rule` is
+ * criteria" shows up as data (`norn run list` sums `unverified_needs`). `rule` is
-/** BS7/BS9: when a waiting story counts as stale, and the step `norn update` re-enters. */
+/** BS7/BS9: when a waiting story counts as stale, and the step `norn story update-branch` re-enters. */
-    /** step `norn update` re-enters (BS9); default: the first step with `action: update` */
+    /** step `norn story update-branch` re-enters (BS9); default: the first step with `action: update` */

common.ts (ExitCode, CliError): unchanged
