## AC1 mutation 1: undeclared @norn/fake import in scripts/
+     "dep": "@norn/fake",
+     "file": "scripts/qa-probe.ts",
(fail) dependency direction > root test/ and scripts/ import only packages the root declares [1.17ms]
 42 pass
 1 fail

## AC1 mutation 2: drop @norn/core from root devDependencies, add a root test importing it
(fail) dependency direction > the root declares every package as a dev dependency [0.23ms]
+     "dep": "@norn/core",
+     "file": "test/qa-probe.ts",
+     "dep": "@norn/core",
(fail) dependency direction > root test/ and scripts/ import only packages the root declares [0.64ms]
 41 pass
 2 fail

## restored: real tree
 43 pass
 0 fail

## root imports of @norn by name in the real tree
test/repo.test.ts:73:    writeFileSync(join(root, "test", "ok.test.ts"), `import { ulid } from "@norn/schema";\n`);
test/repo.test.ts:74:    writeFileSync(join(root, "scripts", "x.ts"), `import { decide } from "@norn/core";\nconst s = await import("@norn/store");\n`);

## root test importing @norn/schema, @norn/store, @norn/cli by name
 1 pass
 0 fail
