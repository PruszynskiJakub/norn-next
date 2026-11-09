### Goal

`norn-retro` lists a story's gate rulings, asks which read as a lasting preference, and proposes for each a `REVIEW.md` line (how code is judged) or an `AGENTS.md`/`CLAUDE.md` line (how agents work) naming file, section, wording and ruling, while still changing no file.

### Proof

- AC1 (section after the friction lists `approve`/`reject` comments with gate, round, words, delegated marked, and asks which last): `packages/cli/test/unit/assets.test.ts` › "norn-retro lists the gate rulings after the friction and asks which read as a lasting preference" (went red first).
- AC2 (`REVIEW.md` vs `AGENTS.md` else `CLAUDE.md`, each naming File, Section, Wording, Ruling; missing file proposed for creation; existing line cited, no duplicate): same file › "norn-retro proposes a REVIEW.md or agent instructions line naming file, section, wording and ruling" (went red first).
- AC3 (still changes no file): same file › "norn-retro changes no file" (new pin of the existing text; green before and after).
- `bun run test` (1562 pass) and `bun run typecheck` green.

### Easy to miss

- `norn-retro` is a craft skill: the "unaware of norn" lint bans the words workflow, receipt, outcome, step, brief in prose (code spans are fine) and any bare `norn`.
- Old sections 3 and 4 were renumbered to 4 and 5; the reply template gained a "Lasting preferences" section.

### Not proven yet

- AC4 (agent run of the retro on a story whose lasting ruling's target file is missing, then where the file already states it): `verifier: agent`, for QA. The skill text covers both (step 3, "Read the target file first").

### Notes

- There was no retro-specific "changes no file" pin before this slice; AC3's pin was added as a new test of the existing wording.
- The bundled skill was edited only at `packages/cli/assets/skills/norn-retro/`; the `.agents/skills/` copy is refreshed by the release.
- Friction: the worktree had no `node_modules`; `bun install` was needed before the baseline ran.

### Resume

Implementation done and committed; next is review, then QA of AC4.
