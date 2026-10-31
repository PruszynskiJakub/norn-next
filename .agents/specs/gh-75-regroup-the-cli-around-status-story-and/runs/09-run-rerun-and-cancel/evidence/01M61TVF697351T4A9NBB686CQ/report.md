# QA gh-75/09 — run rerun and run cancel

Setup: throwaway repo under $TMPDIR (qa-gh75-09/work), HOME isolated, scripted `gh` on PATH serving issue #5, agent `claude` with `command: fake-agent` (a bash loop that logs and traps TERM), runner headless, `bun packages/cli/src/main.ts`. Full suite: 1266 pass, 0 fail (suite.txt). All fake agents stopped at the end.

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| AC1 (B51) | pass | AC9-after-cancel.txt | stuck under Unblock, no relaunch/retry/nudge over 3 ticks |
| AC2 (B51) | pass | AC9-cancel.txt | receipt 0003-stuck.json, then SIGTERM |
| AC3 (B52) | person | AC3.md | everything kept except the Herdr pane: Herdr kill closes it |
| AC4 (B53) | pass | AC6-AC4-cli.txt | nothing_to_cancel exit 3; not_holder by test |
| AC5 (B48) | pass | AC9-rerun.txt, AC5-AC6-cli.txt | --reason, --reset, gate resume |
| AC6 (B49) | pass | AC6-AC4-cli.txt, AC5-AC6-cli.txt | --step both ways |
| AC7 (B50) | pass | AC7.txt | refused running → norn run cancel |
| AC8 (B5, B2) | pass | AC8-cli.txt | unstick exit 2; run lists rerun, cancel |
| AC9 (B51, B52) | pass | AC9-*.txt | live process stopped, fresh one started |

Observed on the side (not criteria): `run rerun`/`run cancel` print JSON even without --json when stdout is not a terminal (AC7.txt); the person-facing markdown path was not exercised here.
