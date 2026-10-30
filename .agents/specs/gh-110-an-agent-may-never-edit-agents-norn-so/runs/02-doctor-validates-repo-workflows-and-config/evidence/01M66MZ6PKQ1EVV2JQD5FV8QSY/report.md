# QA gh-110/02 — doctor repo group, doctor --repo

Full suite: 1428 pass, 0 fail (full-suite.log). Typecheck green. housekeeping.test.ts 18 pass (repo group: 7).

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| AC1 (B7) | pass | AC1-AC2-AC5-broken.md | cycle named with path, exit 1 |
| AC2 (B7) | pass | AC1-AC2-AC5-broken.md, tests-repo-group.txt | tick refusal seen via the test |
| AC3 (B8) | pass | AC3-AC7-config.md | /max_agents: must be integer |
| AC4 (B9) | pass | AC4.md | exit 0, git status clean |
| AC5 (B10) | pass | AC5-clean.md, AC1-AC2-AC5-broken.md | no agent/gh on PATH |
| AC6 (B7,B8) | pass | AC5-clean.md, AC6-help.md | |
| AC7 (B7,B8,B10) | pass | AC1-AC2-AC5-broken.md, AC3-AC7-config.md | |

Observed: while the config fails to load, the missing-skill check is skipped (and doctor says so), so a broken config hides a missing skill until the config is fixed.
