## 06.AC4: pinned outputs vs the merge base with origin/main (5e1fee8464b5018c2ad1d75f22fc2da3e1fd7c6e)
$ git diff --stat <mb> HEAD -- packages/core/test/golden test/e2e/observe-snapshots test/e2e/transcripts
 packages/core/test/golden/run-state-move-0502b627bbf1.json | 1 -
 packages/core/test/golden/run-state-move-285d70f6698e.json | 1 -
 packages/core/test/golden/run-state-move-3be5d31c7fae.json | 1 -
 packages/core/test/golden/run-state-move-c60ef8d41ef2.json | 1 -
 test/e2e/observe-snapshots/fresh-intake.json               | 4 ++--
 test/e2e/observe-snapshots/gate-waiting.json               | 4 ++--
 test/e2e/observe-snapshots/merged.json                     | 4 ++--
 test/e2e/observe-snapshots/parked-ask.json                 | 4 ++--
 test/e2e/observe-snapshots/running-slice.json              | 4 ++--
 test/e2e/transcripts/recovery-claim-lost.txt               | 1 -
 10 files changed, 10 insertions(+), 15 deletions(-)

### golden: name-status (only deletions, all four run-state-move cases; no golden case modified or added)
D	packages/core/test/golden/run-state-move-0502b627bbf1.json
D	packages/core/test/golden/run-state-move-285d70f6698e.json
D	packages/core/test/golden/run-state-move-3be5d31c7fae.json
D	packages/core/test/golden/run-state-move-c60ef8d41ef2.json

### rule cases removed in decide (record.move* rules gone with the cases)
-      for (const u of [uf, ...moving]) if (!u.errors.length && !ctx.has(u.unit.key)) ctx.noop(u.unit, "record.move_waits", why);
-    ctx.emit({ kind: "move_record", unit: uf.unit, rule: "record.move", path: br.path, copy, commit });
-    for (const u of moving) ctx.noop(u.unit, "record.move", `moving with ${uf.unit.key} off ${commit.branch}`);
rule ids record.move* still in src: 0

### transcripts
diff --git a/test/e2e/transcripts/recovery-claim-lost.txt b/test/e2e/transcripts/recovery-claim-lost.txt
index 0e107b7b7..2f11ad4a3 100644
--- a/test/e2e/transcripts/recovery-claim-lost.txt
+++ b/test/e2e/transcripts/recovery-claim-lost.txt
@@ -122,7 +122,6 @@
   spawn repo-b $ git rev-parse --verify --quiet --end-of-options refs/remotes/origin/gh-9-add-search
   spawn repo-b $ git rev-parse --verify --quiet --end-of-options refs/remotes/origin/gh-9-add-search
   spawn repo-b $ git show <sha:4>:.agents/specs/gh-9-add-search/spec.md
-  spawn repo-b $ git cat-file -e <sha:4>:.agents/specs/gh-9-add-search/runs
   spawn repo-b $ git show <sha:4>:.agents/workflows/solo.yaml
   spawn repo-b $ git log "--format=%x1e%(trailers:only,unfold)" "--grep=^Norn-Outcome: " refs/remotes/origin/gh-9-add-search
   spawn repo-b $ git ls-remote origin refs/norn/claims/gh-9

### observe snapshots (all five)
diff --git a/test/e2e/observe-snapshots/fresh-intake.json b/test/e2e/observe-snapshots/fresh-intake.json
index 56a3b1ea7..b63f1d711 100644
--- a/test/e2e/observe-snapshots/fresh-intake.json
+++ b/test/e2e/observe-snapshots/fresh-intake.json
@@ -34,2 +34,2 @@
-    "repo": "0.19.0",
-    "running": "0.19.0",
+    "repo": "0.30.0",
+    "running": "0.30.0",
diff --git a/test/e2e/observe-snapshots/gate-waiting.json b/test/e2e/observe-snapshots/gate-waiting.json
index 0dbb7596f..c2078adf9 100644
--- a/test/e2e/observe-snapshots/gate-waiting.json
+++ b/test/e2e/observe-snapshots/gate-waiting.json
@@ -50,2 +50,2 @@
-    "repo": "0.19.0",
-    "running": "0.19.0",
+    "repo": "0.30.0",
+    "running": "0.30.0",
diff --git a/test/e2e/observe-snapshots/merged.json b/test/e2e/observe-snapshots/merged.json
index 676f9e829..0d86cb00c 100644
--- a/test/e2e/observe-snapshots/merged.json
+++ b/test/e2e/observe-snapshots/merged.json
@@ -17,2 +17,2 @@
-    "repo": "0.19.0",
-    "running": "0.19.0",
+    "repo": "0.30.0",
+    "running": "0.30.0",
diff --git a/test/e2e/observe-snapshots/parked-ask.json b/test/e2e/observe-snapshots/parked-ask.json
index a79f55ef1..a8447c0a7 100644
--- a/test/e2e/observe-snapshots/parked-ask.json
+++ b/test/e2e/observe-snapshots/parked-ask.json
@@ -50,2 +50,2 @@
-    "repo": "0.19.0",
-    "running": "0.19.0",
+    "repo": "0.30.0",
+    "running": "0.30.0",
diff --git a/test/e2e/observe-snapshots/running-slice.json b/test/e2e/observe-snapshots/running-slice.json
index dcd6d2952..07861e267 100644
--- a/test/e2e/observe-snapshots/running-slice.json
+++ b/test/e2e/observe-snapshots/running-slice.json
@@ -64,2 +64,2 @@
-    "repo": "0.19.0",
-    "running": "0.19.0",
+    "repo": "0.30.0",
+    "running": "0.30.0",

### the observe-snapshot harness
diff --git a/test/e2e/observe-snapshots.test.ts b/test/e2e/observe-snapshots.test.ts
index f1f977b2f..9f96cbba0 100644
--- a/test/e2e/observe-snapshots.test.ts
+++ b/test/e2e/observe-snapshots.test.ts
@@ -92,3 +92,3 @@ describe("observe snapshots and inbox parity (refactor Phase 0.3)", () => {
     // A fixed binary version, recorded as the repo's, so the Facts' \`norn\` part does not move with each release
-    h = await createHarness({ version: "0.19.0" });
+    h = await createHarness({ version: "0.30.0" });
     expect((await h.norn("init")).exit).toBe(0);

### every remaining golden case decides as pinned: replay of the corpus (packages/core/test/unit/golden.test.ts, read-only)
cases in corpus: 132; at merge base: 136
```
bun test v1.3.13 (bf2e2cec)

 329 pass
 0 fail
 209 expect() calls
Ran 329 tests across 1 file. [195.00ms]
```
porcelain after: ''
