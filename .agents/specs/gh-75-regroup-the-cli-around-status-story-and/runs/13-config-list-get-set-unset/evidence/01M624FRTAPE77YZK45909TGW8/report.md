# QA gh-75/13 (qa#2) — dev build `bun packages/cli/src/main.ts` in throwaway repos under $TMPDIR, NORN_HOME_DIR=$TMPDIR/qa13-home

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| AC1 (B61, B6) | pass | AC1.md | list/get --json byte-identical to released 0.10.0 |
| AC2 (B62) | pass | AC2.md | |
| AC3 (B63) | pass | AC3.md | |
| AC4 (B64) | pass | AC4.md | pty via expect; Esc/Ctrl-C → cancelled, files unchanged |
| AC5 (B65) | pass | AC5.md | |
| AC6 (B66) | pass | AC6.md | sha-checked unchanged |
| AC7 (B67) | pass | AC7.md | padded inline comments kept on every path tried |
| AC8 (B68) | pass | AC8.md | |
| AC9 (B62, B67) | pass | AC9.md | one-line git diff for set and unset |
