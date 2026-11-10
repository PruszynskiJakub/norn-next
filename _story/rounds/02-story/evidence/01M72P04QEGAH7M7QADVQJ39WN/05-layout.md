## 05 fixture: a repo holding only the pre-0.13 files (.agents/norn/config.yaml, .agents/norn/workflows/duo.yaml, .agents/norn/trace/2026-01-01.jsonl), committed
.agents/norn/config.yaml
.agents/norn/trace/2026-01-01.jsonl
.agents/norn/workflows/duo.yaml

## 05.AC1: acting commands
$ norn tick --json
{"error":"this repo records no norn_version","do_instead":"run `norn init` if norn was never set up here; for a repo from an older norn, install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0","code":"version_missing","details":{"repo":null,"running":"0.30.0"}}

exit=3  repo+machine-dir changed: no

$ norn story start gh-3 --json
{"error":"this repo records no norn_version","do_instead":"run `norn init` if norn was never set up here; for a repo from an older norn, install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0","code":"version_missing","details":{"repo":null,"running":"0.30.0"}}

exit=3  repo+machine-dir changed: no

$ norn config set mode auto --local --json
{"error":"this repo records no norn_version","do_instead":"run `norn init` if norn was never set up here; for a repo from an older norn, install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0","code":"version_missing","details":{"repo":null,"running":"0.30.0"}}

exit=3  repo+machine-dir changed: no

old files unchanged: yes; porcelain: ''

## 05.AC2: agent hooks (stop, pre-tool-use) in a unit worktree whose marker points at this repo
repo=/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa6-gh317/p13
story=gh-3
slice=
unit=_story
spec_dir=.agents/specs/gh-3-add-totals
$ norn hook stop --json
{}

exit=0
$ norn hook pre-tool-use --json
{}

exit=0
old files unchanged: yes

## 05.AC3: doctor on the pre-0.13 repo and on a 0.30.0 repo
### p13: norn doctor 
--json repo keys: ok,version,skills,workflows,config | top: ok,live,hook_command,machine,git,agents,remote,labels,runner,skills,repo,warnings,hints
lines matching /layout|migrate/i in --json: 0
lines matching /layout|migrate/i in markdown: 0
### p13: norn doctor --repo
--json repo keys: ok,version,skills,workflows,config | top: ok,repo
lines matching /layout|migrate/i in --json: 0
lines matching /layout|migrate/i in markdown: 0
### base: norn doctor 
--json repo keys: ok,version,skills,workflows,config | top: ok,live,hook_command,machine,git,agents,remote,labels,runner,skills,repo,warnings,hints
lines matching /layout|migrate/i in --json: 0
lines matching /layout|migrate/i in markdown: 0
### base: norn doctor --repo
--json repo keys: ok,version,skills,workflows,config | top: ok,repo
lines matching /layout|migrate/i in --json: 0
lines matching /layout|migrate/i in markdown: 0

### markdown doctor on the pre-0.13 repo (full)
norn doctor: 4 checks failed (agent claude, remote, skills, norn)

  ok   git            git version 2.54.0 (Apple Git-157)
  FAIL agent claude   /Users/jakubpruszynski/.local/bin/claude (2.1.322 (Claude Code)) · hooks missing
                      · run norn init to install hooks
  FAIL remote         gh as PruszynskiJakub
                      ! this repository has no git remote named origin
                      → git remote add origin <url>
  ok   runner         herdr available · sessions run this norn
                      · cockpit plugin linked
  FAIL skills         missing norn, norn-clarify, norn-codebase-design, norn-diagnose, norn-fsd, norn-fsd-round, norn-implement, norn-interview, norn-merge, norn-plan, norn-pr, norn-prototype, norn-qa, norn-qa-person, norn-refine, norn-retro, norn-review, norn-slice, norn-tdd, norn-triage; not linked for claude: norn, norn-clarify, norn-codebase-design, norn-diagnose, norn-fsd, norn-fsd-round, norn-implement, norn-interview, norn-merge, norn-plan, norn-pr, norn-prototype, norn-qa, norn-qa-person, norn-refine, norn-retro, norn-review, norn-slice, norn-tdd, norn-triage
                      → norn init
       machine        jakubpruszynski@mac
  FAIL norn           this repo records no norn_version
                      → run `norn init` if norn was never set up here; for a repo from an older norn, install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0
  ok   workflows      none valid in .agents/workflows/
  ok   config         .agents/norn.config.yaml (none: built-in defaults)

Warnings
  ! labels not checked: no git remote
