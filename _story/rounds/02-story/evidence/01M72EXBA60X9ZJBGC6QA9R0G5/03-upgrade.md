## 03.AC1 + AC8: repo 0.30.0, norn 0.31.0 (norn-qa skill differs)
$ norn upgrade --json
{"norn_version":{"from":"0.30.0","to":"0.31.0","changed":true},"skills":{"updated":["norn-qa"],"linked":[]},"staged":[".agents/skills/norn-qa",".agents/norn.config.yaml"],"commit":"git commit -m \"Upgrade norn to 0.31.0 (norn upgrade)\"","labels":{"checked":false,"reason":"no git remote","fix":null,"do_instead":null}}

exit=0  repo+machine-dir changed: YES

HEAD unchanged: yes
staged:
M	.agents/norn.config.yaml
M	.agents/skills/norn-qa/SKILL.md
unstaged:        0
norn_version: 0.31.0
skill content: QA-MARKER 0.31
lrwxr-xr-x@ 1 jakubpruszynski  staff  28 Nov 10 11:12 .claude/skills/norn-qa -> ../../.agents/skills/norn-qa
via link: QA-MARKER 0.31
json keys:

### markdown run (fresh copy)
$ norn upgrade
# norn upgrade

norn version 0.30.0 → 0.31.0; skills updated: norn-qa

Skills rewritten from norn 0.31.0's copies (`git diff --staged .agents/skills/` shows how): norn-qa

.agents/norn.config.yaml: `norn_version: 0.31.0` (staged)

labels: not checked — no git remote

Review the staged changes with `git diff --staged`, then commit them: `git commit -m "Upgrade norn to 0.31.0 (norn upgrade)"`

exit=0  repo+machine-dir changed: YES

## 03.AC4: commit, rerun
$ norn upgrade
# norn upgrade

already on norn 0.31.0: nothing to upgrade

labels: not checked — no git remote

exit=0  repo+machine-dir changed: no

$ norn upgrade --json
{"norn_version":{"from":"0.31.0","to":"0.31.0","changed":false},"skills":{"updated":[],"linked":[]},"staged":[],"commit":null,"labels":{"checked":false,"reason":"no git remote","fix":null,"do_instead":null}}

exit=0  repo+machine-dir changed: no

staged:        0
### only a skill differs
$ norn upgrade --json
{"norn_version":{"from":"0.31.0","to":"0.31.0","changed":false},"skills":{"updated":["norn-tdd"],"linked":[]},"staged":[".agents/skills/norn-tdd"],"commit":"git commit -m \"Refresh norn's skills (norn upgrade)\"","labels":{"checked":false,"reason":"no git remote","fix":null,"do_instead":null}}

exit=0  repo+machine-dir changed: YES

.agents/skills/norn-tdd/SKILL.md
## 03.AC2: interrupted after skills, before version
norn_version: 0.30.0
$ norn upgrade --json
{"norn_version":{"from":"0.30.0","to":"0.31.0","changed":true},"skills":{"updated":[],"linked":[]},"staged":[".agents/norn.config.yaml"],"commit":"git commit -m \"Upgrade norn to 0.31.0 (norn upgrade)\"","labels":{"checked":false,"reason":"no git remote","fix":null,"do_instead":null}}

exit=0  repo+machine-dir changed: YES

norn_version: 0.31.0
