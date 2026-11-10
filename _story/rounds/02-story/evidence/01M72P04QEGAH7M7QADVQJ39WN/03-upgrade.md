## 03.AC1 + 03.AC8: repo 0.30.0, norn 0.31.0 (its norn-qa skill differs), .claude/skills/norn-tdd link removed
$ norn upgrade --json
{"norn_version":{"from":"0.30.0","to":"0.31.0","changed":true},"skills":{"updated":["norn-qa"],"linked":["norn-tdd"]},"staged":[".agents/skills/norn-qa",".claude/skills/norn-tdd",".agents/norn.config.yaml"],"commit":"git commit -m \"Upgrade norn to 0.31.0 (norn upgrade)\"","labels":{"checked":false,"reason":"no git remote","fix":null,"do_instead":null}}

exit=0  repo+machine-dir changed: YES

HEAD unchanged: yes
staged:
M	.agents/norn.config.yaml
M	.agents/skills/norn-qa/SKILL.md
A	.claude/skills/norn-tdd
unstaged: 0
norn_version: 0.31.0
skill tail: QA-MARKER 0.31
8 Nov 10 13:16 .claude/skills/norn-qa -> ../../.agents/skills/norn-qa
9 Nov 10 13:16 .claude/skills/norn-tdd -> ../../.agents/skills/norn-tdd
via link: QA-MARKER 0.31
### markdown run (fresh copy)
$ norn upgrade
# norn upgrade

norn version 0.30.0 → 0.31.0; skills updated: norn-qa

Skills rewritten from norn 0.31.0's copies (`git diff --staged .agents/skills/` shows how): norn-qa

.agents/norn.config.yaml: `norn_version: 0.31.0` (staged)

labels: not checked — no git remote

Review the staged changes with `git diff --staged`, then commit them: `git commit -m "Upgrade norn to 0.31.0 (norn upgrade)"`

exit=0  repo+machine-dir changed: YES

## 03.AC8: top-level keys of the --json value
norn_version,skills,staged,commit,labels | norn_version: from,to,changed | skills: updated,linked
## 03.AC2: interrupted after the skills (norn-qa already rewritten and committed), version still 0.30.0
$ norn upgrade --json
{"norn_version":{"from":"0.30.0","to":"0.31.0","changed":true},"skills":{"updated":[],"linked":[]},"staged":[".agents/norn.config.yaml"],"commit":"git commit -m \"Upgrade norn to 0.31.0 (norn upgrade)\"","labels":{"checked":false,"reason":"no git remote","fix":null,"do_instead":null}}

exit=0  repo+machine-dir changed: YES

HEAD unchanged: yes
staged:
M	.agents/norn.config.yaml
unstaged: 0
norn_version: 0.31.0
### interrupted with the skill rewrite left unstaged
$ norn upgrade --json
{"norn_version":{"from":"0.30.0","to":"0.31.0","changed":true},"skills":{"updated":[],"linked":[]},"staged":[".agents/norn.config.yaml"],"commit":"git commit -m \"Upgrade norn to 0.31.0 (norn upgrade)\"","labels":{"checked":false,"reason":"no git remote","fix":null,"do_instead":null}}

exit=0  repo+machine-dir changed: YES

HEAD unchanged: yes
staged:
M	.agents/norn.config.yaml
unstaged: 1
norn_version: 0.31.0
## 03.AC4: repo upgraded to 0.31.0 and committed, rerun
norn_version: 0.31.0
$ norn upgrade
# norn upgrade

already on norn 0.31.0: nothing to upgrade

labels: not checked — no git remote

exit=0  repo+machine-dir changed: no

$ norn upgrade --json
{"norn_version":{"from":"0.31.0","to":"0.31.0","changed":false},"skills":{"updated":[],"linked":[]},"staged":[],"commit":null,"labels":{"checked":false,"reason":"no git remote","fix":null,"do_instead":null}}

exit=0  repo+machine-dir changed: no

staged: 0
### only a skill differs (norn-tdd edited by hand and committed)
$ norn upgrade --json
{"norn_version":{"from":"0.31.0","to":"0.31.0","changed":false},"skills":{"updated":["norn-tdd"],"linked":[]},"staged":[".agents/skills/norn-tdd"],"commit":"git commit -m \"Refresh norn's skills (norn upgrade)\"","labels":{"checked":false,"reason":"no git remote","fix":null,"do_instead":null}}

exit=0  repo+machine-dir changed: YES

staged:
.agents/skills/norn-tdd/SKILL.md
