## 04.AC2: repo with no team file, norn init
ls: .agents: No such file or directory
{"root":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa6-gh317/i1","config":"created","review":"created","user_config":"created","schemas":["/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa6-gh317/i1/.agents/norn.config.schema.json","/private/var/folders/rb/k1spzrcd5lx7cb_bkz
exit=0
22:norn_version: 0.30.0

## 04.AC3: team file exists with no norn_version / 0.29.4 → see 02-guard-2.md (init --json exit 3, repo unchanged). Markdown form:
$ norn init
**Refused (version_missing):** this repo records no norn_version

Do instead: run `norn init` if norn was never set up here; for a repo from an older norn, install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0

exit=3  repo+machine-dir changed: no

$ norn init
**Refused (version_too_old):** this repo records norn_version 0.29.4; this norn moves a repo from norn 0.30 on

Do instead: install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0

exit=3  repo+machine-dir changed: no

## 04.AC4: team file at 0.30.0, norn 0.31.0, norn-qa differs; plus a hand-edited norn-tdd
$ norn init
norn init in /private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa6-gh317/i4

norn version: 0.30.0

  config          .agents/norn.config.yaml kept (exists)
  user config     ~/.norn/config.yaml kept (exists)
  review          REVIEW.md kept (exists)
  workflows       kept quick.yaml, refinement.yaml, reproduce.yaml, slice.yaml, story.yaml, triage.yaml
  skills          .agents/skills: up to date; kept norn-qa, norn-tdd (norn 0.30.0's to change) (20 skills)
                  claude → .claude/skills: all linked
  hooks           claude: up to date
  hook command    "${NORN_BIN:-norn}" hook
  .gitignore      up to date
  remote          no git remote named origin
  labels          not checked — no git remote

this repo is on norn 0.30.0, you run 0.31.0: `norn upgrade` moves it, with the bundled skills that differ: norn-qa, norn-tdd

Nothing changed: norn is set up here.

Next steps
  1. Add the remote norn syncs issues from and pushes branches to: `git remote add origin <url>`.
  2. Check this machine: `norn doctor`.
  3. Make a first story: an issue labelled `norn` and assigned to you, e.g. `gh issue create --label norn --assignee @me --title "…"`.
  4. Pick it up: `norn sync`, keep `norn watch` running (it moves every step on, in manual mode too), and `norn status` shows what needs you and the command for each item.

exit=0  repo+machine-dir changed: no

norn_version: 0.30.0
norn-qa tail: Done when every criterion has exactly one verdict; every `pass` has evidence (a screenshot when seen in a browser); every `fail` has a repro and a finding; every `person` and `unverified` says how to check it; secrets are redacted; and `report.md` has one line per criterion.
norn-tdd tail: junk
