### Goal
Bundled skills stop repeating the push and branch rules the brief's How to work already states (D15), and no bundled skill names the mode, so the brief alone adapts the skills to the step.

### Proof
| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | "never push" gone from norn-implement and norn-merge (Commit locally kept), "Never push." from norn-diagnose, "Never create or switch branches for it." from norn-prototype, nothing else dropped | test | `packages/cli/test/unit/assets.test.ts` › skills › "skills leave the push and branch rules to the brief, keeping committing locally as craft" |
| AC2 | no bundled skill names the mode (auto or manual) | test | `packages/cli/test/unit/assets.test.ts` › skills › "%s names no mode" (each skill) |

- The diff in `packages/cli/assets/skills/` is exactly four one-line edits; the AC1 test also pins the text kept around each removed sentence.
- `bun run test` (1580 pass) and `bun run typecheck` are green.

### Easy to miss
- Edit only `packages/cli/assets/skills/`. The `.agents/skills/` and `.claude/skills/` copies get refreshed at release, so they still contain the old lines.
- The supervisor skills (`norn-fsd`, `norn-fsd-round`) use the CLI flags `--auto` and `--manual` to set a story's mode. The mode pin strips those flags before it checks. Removing them would change those skills, which this slice puts out of scope.

### Not proven yet
Nothing.

### Notes
- How "names the mode" is read: prose that pairs auto/manual with mode/step/story, either way round (e.g. "auto mode", "mode is manual"). Plain "manual" in another sense, such as norn-retro's "a manual check", is allowed. So are the supervisors' `--auto` and `--manual` flags.

### Resume
Review #1 approved with no findings. Next comes the slice's QA or gate, per the workflow.
