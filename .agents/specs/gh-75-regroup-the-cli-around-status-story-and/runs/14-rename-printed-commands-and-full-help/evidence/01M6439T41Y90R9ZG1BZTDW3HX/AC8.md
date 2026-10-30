# AC8 — every printed command works when pasted
Driver: AC8-driver.test.ts (dev-build CLI in-process on the test harness: real git repo + bare origin, fake GitHub remote and runner). Five stories: gh-5 at a gate (agent ran `norn done done`), gh-6 a question (`norn ask`), gh-7 stuck (`norn stuck`), gh-8 corrupt state.json, gh-9 running.
Harvested every `norn …` command printed by `norn status` (markdown + --json), `norn story view gh-5..9` (markdown + --json) and the cockpit model (`norn status --watch --json`): 24 distinct. Pasted each (shell-split, run as typed):
- 19 read commands (`run list`, `run view … --why`, `story view`, `story view --web`): exit 0.
- `norn story answer gh-6 "…"`, `norn story approve gh-5`, `norn run rerun gh-7`: exit 0; after 2 ticks gh-5 done, gh-6 resumed work, gh-7 at work#2 (AC8-drive.log).
- `norn story reject gh-5 --reason "…"`: refused only because approve had already been pasted for the same gate (already_recorded, the alternative). Second drive pasting reject first (AC8-drive-reject-first.log): reject exit 0 and gh-5 went back to work#2 [loop 1/2]; approve then refused already_recorded, as expected.
Not checked live: the cockpit's full-screen TUI under a real terminal/Herdr (its model's commands were pasted), and against real GitHub (the person checked story create against real GitHub at gh-75/12).
Side effect: the first drive pasted `story view --web`, which opened github.com/o/r/issues/N (fake URLs) through the default opener.
