# QA gh-75/13: config list, get, set, unset

Dev build (`bun packages/cli/src/main.ts`) in throwaway repos under the scratchpad, `NORN_HOME_DIR` pointing at a temp home, norn launch env removed. Interactive cases driven through a real pty with `expect` (`pick.exp`, `run.exp`; wrapper `n`).
Full suite: 1260 pass, 1 fail (`cockpit.test.ts` CP6 frame count; passes 3/3 alone, not touched by this diff: flaky under load). Typecheck green.

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| AC1 (B61, B6) | pass | AC1.md, AC1-new.json, AC1-old.json | `config list --json` byte-identical to released `norn config --json`; `get default_mode --json` identical to released `config default_mode --json`; old form → exit 2 |
| AC2 (B62) | pass | AC2.md | --user writes `default_mode: auto`, get shows source user; --repo writes .agents/norn/config.yaml |
| AC3 (B63) | pass | AC3.md | agents.claude.model, limits.deadline, notifiers list replaced whole; `notifiers.0` refused |
| AC4 (B64) | pass | AC4.md | real pty: question text exact, Down+Enter → repo, Enter → user, q → refused cancelled, nothing written |
| AC5 (B65) | pass | AC5.md | no TTY, --json at a pty, NORN_RUN agent session: exit 2, do_instead "pass --user or --repo"; both flags exit 2; files unchanged |
| AC6 (B66) | pass | AC6.md | slots.max lots / limits.deadline forever → invalid_value naming the path; unknown key → unknown_key; exit 3; cmp byte-identical |
| AC7 (B67) | **fail** | AC7.md | changed scalar: 1 line; **new key: untouched lines' comment padding rewritten (F1)** |
| AC8 (B68) | pass | AC8.md | unset shows next layer (repo→user→built-in); missing key exit 0, file sha unchanged; empty map dropped; pick at pty works |
| AC9 (B62, B67) | **fail** | AC9.md | set/unset of existing keys at a pty: one-line diff; set of a new key: 3-line diff (F2, same cause as F1) |

Also seen (not a criterion): review note 1 reproduced — `agents.claude.model opus --repo` seeds the repo file with the built-in agent's args (AC3.md).
