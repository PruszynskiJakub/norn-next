# AC1 (B18) — old layout refuses with old_layout / norn migrate
Throwaway repo $TMPDIR/qa-gh110-05/repo, `norn init` (dev build `bun packages/cli/src/main.ts`, NORN_HOME_DIR isolated), committed; then by hand:
config → .agents/norn/config.yaml, workflows → .agents/norn/workflows, machine dir → .agents/norn/trace.
- status, status --json, tick --json, watch --json, story list --json: exit 3, code `old_layout`, error names the main checkout and each part, `do_instead: "norn migrate"`, valid CliError JSON (AC1-AC3-AC5-old.txt). Markdown form: `**Refused (old_layout):** … Do instead: norn migrate`.
- Each part alone (config only, workflows only, machine files only): refuses old_layout naming that one part (AC1-per-part.txt).
- Edge: an empty .agents/norn/trace is not "old" — status works (AC1-per-part.txt).
- Nothing changed on disk (old-before.sha == old-after.sha).
- Test: packages/cli/test/layout-guard.test.ts 13/13 pass (layout-guard-test.log).
