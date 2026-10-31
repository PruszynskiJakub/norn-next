# AC3 — headless default log dir comes from store

Code: packages/adapters/src/headless/index.ts headlessFactory → `runnerLogDir(ctx.repoRoot)` (store paths.ts: `join(traceDir(root), "runs")`); no literal path left.

Through the library entry point (`import { headless } from "@norn/adapters"`), a temp repo, no `log_dir` option, launching `sh -c "echo hello-ac3"`:

```
root: /var/folders/.../T/qa-ac3-FqCzJM
files in <root>/.agents/norn/trace/runs: [ "01JQAAC3.log" ]
log content: hello-ac3
```

Same place as before the change (`<repo>/.agents/norn/trace/runs`). Unit test `headless.test.ts` "without log_dir, logs go to store's runner log dir…" passes in the full suite (see AC1-suite.txt).
