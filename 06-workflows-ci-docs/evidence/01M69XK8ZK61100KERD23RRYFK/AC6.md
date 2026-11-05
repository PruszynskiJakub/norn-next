## AC6
diff --git a/.github/workflows/release.yml b/.github/workflows/release.yml
index 3cb378a30..9ea9845bd 100644
--- a/.github/workflows/release.yml
+++ b/.github/workflows/release.yml
@@ -133,12 +133,14 @@ jobs:
 
       - run: bun install --frozen-lockfile
 
+      # The unit tier and the type check only: the release PR's CI ran every tier on this commit (gh-118 B13).
+      # The git identity stays for the smoke steps below.
       - name: Test
         run: |
           git config --global user.name "norn ci"
           git config --global user.email "ci@norn.invalid"
           git config --global init.defaultBranch main
-          bun test
+          bun run test
           bun run typecheck
 
       - name: Build
$ grep -n -E "integration|e2e|bun run test|typecheck" .github/workflows/release.yml
143:          bun run test
144:          bun run typecheck
