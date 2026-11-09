### Goal
Bundled skills stop repeating the push and branch rules the brief's How to work already states (D15), and no bundled skill names the mode, so the brief alone adapts the skills to the step.

### Proof
- AC1 (the four lines dropped, "Commit locally" kept, nothing else dropped): `packages/cli/test/unit/assets.test.ts` › skills › "skills leave the push and branch rules to the brief, keeping committing locally as craft". It went red before the skill edits. It also pins the text that stays around each removed sentence. The diff in `packages/cli/assets/skills/` is exactly four one-line edits.
- AC2 (no skill names the mode): `assets.test.ts` › skills › "%s names no mode", run once per bundled skill. It passed from the start, because no skill names the mode today; it guards against regressions.
- `bun run test` (1580 pass) and `bun run typecheck` are green.

### Easy to miss
- Edit only `packages/cli/assets/skills/`. The `.agents/skills/` and `.claude/skills/` copies get refreshed at release, so they still contain the old lines.
- The supervisor skills (`norn-fsd`, `norn-fsd-round`) use the CLI flags `--auto` and `--manual` to set a story's mode. The mode pin strips those flags before it checks. Removing them would change those skills, which this slice puts out of scope.

### Not proven yet
Nothing.

### Notes
- How "names the mode" is read: prose that pairs auto/manual with mode/step/story, either way round (e.g. "auto mode", "mode is manual"). Plain "manual" in another sense, such as norn-retro's "a manual check", is allowed. So are the supervisors' `--auto` and `--manual` flags.

### Resume
Implementation is done and committed. Next comes the slice's test check, then review.
