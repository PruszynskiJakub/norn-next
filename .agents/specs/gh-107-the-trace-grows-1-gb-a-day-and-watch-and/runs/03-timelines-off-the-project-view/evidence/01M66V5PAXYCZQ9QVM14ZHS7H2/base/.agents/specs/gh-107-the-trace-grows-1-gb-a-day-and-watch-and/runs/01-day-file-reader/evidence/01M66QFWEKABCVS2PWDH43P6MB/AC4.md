# AC4 (B4) — branch output matches the released norn on a throwaway repo with a few days of trace
Released norn on PATH is 0.12.1, which renamed these commands (`trace` → `run list`, `inbox --history` → `status --history`) and has no `trace`/`inbox`. This branch is at 0.11.1. So the reference is the v0.11.1 release built from its tag (git archive), which is also an ancestor of the slice base with zero package changes between them; the slice-base build was run as well.
Repo: git init in $TMPDIR, copied 2026-10-27..29.jsonl (23,499 real lines) + .agents/specs/gh-75-* (story + 12 slices).
Results (branch vs v0.11.1):
- `inbox --history` markdown (114 KB, 692 lines) and --json (181 KB): byte-identical.
- `trace gh-75`, `gh-75/01`, `/03`, `/12`: markdown byte-identical; slice JSON byte-identical; story JSON identical apart from the open gate's now-relative durations (v0.11.1 vs base differ the same way).
- Older-norn format (every line rewritten with `type` as the last key): branch == v0.11.1 for trace gh-75 --json (modulo durations), trace gh-75/01 md, inbox --history md; and branch output on the old format == branch output on the new format.
Files: AC4/*
