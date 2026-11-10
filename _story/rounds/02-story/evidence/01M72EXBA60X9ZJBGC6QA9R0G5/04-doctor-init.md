## 04.AC1 doctor, norn_version=none
$ norn doctor --json | .norn_version (and top-level keys)
exit=1
keys: ok,live,hook_command,machine,git,agents,remote,labels,runner,skills,repo,warnings,hints
$ norn doctor (version lines)
2-
3:  ok   git            git version 2.54.0 (Apple Git-157)
4-  ok   agent claude   /Users/jakubpruszynski/.local/bin/claude (2.1.322 (Claude Code)) · hooks fire
5-  FAIL remote         gh as PruszynskiJakub
--
11-       machine        tester@box
12:  FAIL norn           this repo records no norn_version
13-                      → run `norn init` if norn was never set up here; for a repo from an older norn, install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0
14-  ok   workflows      quick, refinement, reproduce, slice, story, triage valid (.agents/workflows/)
## 04.AC1 doctor, norn_version=0.29.4
$ norn doctor --json | .norn_version (and top-level keys)
exit=1
keys: ok,live,hook_command,machine,git,agents,remote,labels,runner,skills,repo,warnings,hints
$ norn doctor (version lines)
2-
3:  ok   git            git version 2.54.0 (Apple Git-157)
4-  ok   agent claude   /Users/jakubpruszynski/.local/bin/claude (2.1.322 (Claude Code)) · hooks fire
5-  FAIL remote         gh as PruszynskiJakub
--
11-       machine        tester@box
12:  FAIL norn           this repo records norn_version 0.29.4; this norn moves a repo from norn 0.30 on
13-                      → install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0
14-  ok   workflows      quick, refinement, reproduce, slice, story, triage valid (.agents/workflows/)
## 04.AC4 init on a 0.30.0 team file with norn 0.31.0 (norn-qa differs)
"skills":{"dir":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/gh317-qa/init30/.agents/skills","updated":[],"unchanged":["norn","norn-clarify","norn-codebase-design","norn-diagnose","norn-fsd","norn-fsd-round","norn-implement","norn-interview","norn-merge","norn-plan","norn-pr","norn-prototype","norn-qa-person","norn-refine","norn-retro","norn-review","norn-slice","norn-tdd","norn-triage"],"links":[…]}
exit=0  repo+machine-dir changed: no
norn_version: 0.30.0
skill kept: Done when every criterion has exactly one verdict; every `pa
3:norn version: 0.30.0
