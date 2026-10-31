# AC3 (B16)
Planted packages/cli/test/integration/zz-qa-probe.test.ts containing `import "../../../../test/support/transcript.ts"`, ran `bun test test/repo.test.ts -t B16`: exit 1, the rule "B16: only test/e2e/ imports the transcript recorder…" failed with `"file": "packages/cli/test/integration/zz-qa-probe.test.ts"` (AC3-probe.txt). Probe removed; git status clean.
Without the probe, both B16 rules (real tree + fixture covering unit and integration) pass.
