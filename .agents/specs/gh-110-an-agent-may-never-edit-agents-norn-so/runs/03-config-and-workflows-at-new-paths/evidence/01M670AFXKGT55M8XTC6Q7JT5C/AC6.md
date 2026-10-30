# AC6 / CLI evidence — throwaway repo /var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa-repo-7ZnJ (dev build: bun packages/cli/src/main.ts)

$ norn init
norn init in /private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa-repo-7ZnJ

  config          .agents/norn.config.yaml created
  workflows       created bug.yaml, slice.yaml, story.yaml
  skills          .agents/skills: updated norn, norn-clarify, norn-codebase-design, norn-diagnose, norn-implement, norn-interview, norn-merge, norn-plan, norn-pr, norn-prototype, norn-qa, norn-qa-person, norn-refine, norn-retro, norn-review, norn-slice, norn-tdd (17 skills)
                  claude → .claude/skills: linked norn, norn-clarify, norn-codebase-design, norn-diagnose, norn-implement, norn-interview, norn-merge, norn-plan, norn-pr, norn-prototype, norn-qa, norn-qa-person, norn-refine, norn-retro, norn-review, norn-slice, norn-tdd
  hooks           claude: installed in .claude/settings.json
  hook command    "${NORN_BIN:-norn}" hook
  .gitignore      added .agents/norn/trace/, .env.norn, .norn-unit
  .gitattributes  added .agents/specs/*/runs/** linguist-generated=true gitlab-generated=true
  test command    bun test (not detected: the template's default)
  remote          no git remote named origin

Next steps
  1. Add the remote norn syncs issues from and pushes branches to: `git remote add origin <url>`.
  2. Set your test command: the `test` steps in .agents/workflows/ run `bun test` — change `run:` there.
  3. Commit and push the setup: `git add .agents .claude .gitignore .gitattributes && git commit -m "Set up norn" && git push`.
  4. Check this machine: `norn doctor`.
  5. Make a first story: an issue labelled `norn` and assigned to you, e.g. `gh label create norn` (once), then `gh issue create --label norn --assignee @me --title "…"`.
  6. Pick it up: `norn sync`, then `norn status` shows what needs you and the command for each item; `norn watch` keeps norn working.
exit 0

$ find .agents -maxdepth 2 | sort
.agents
.agents/norn.config.yaml
.agents/skills
.agents/skills/norn
.agents/skills/norn-clarify
.agents/skills/norn-codebase-design
.agents/skills/norn-diagnose
.agents/skills/norn-implement
.agents/skills/norn-interview
.agents/skills/norn-merge
.agents/skills/norn-plan
.agents/skills/norn-pr
.agents/skills/norn-prototype
.agents/skills/norn-qa
.agents/skills/norn-qa-person
.agents/skills/norn-refine
.agents/skills/norn-retro
.agents/skills/norn-review
.agents/skills/norn-slice
.agents/skills/norn-tdd
.agents/workflows
.agents/workflows/bug.yaml
.agents/workflows/slice.yaml
.agents/workflows/story.yaml

$ head -5 .agents/norn.config.yaml
# norn repo config: .agents/norn/config.yaml
#
# Run `norn config` to see every setting in effect, which file set it and what it does.
#
# Two files take these same keys:

$ norn config list
# Config

- user: `/Users/jakubpruszynski/.norn/config.yaml`
- repo: `.agents/norn.config.yaml`

The repo file overrides the user file, except machine caps, which it can only lower.

## This machine (usually in the user file)

| Setting | Value | From | What it does |
|---|---|---|---|
| `runner` | `{"adapter":"herdr"}` | user | starts agents in auto mode; none: every story runs manual |
| `max_agents` | `4` | user | agents running at once on this machine, across repos |
| `max_checks` | `2` | built-in | checks running at once on this machine |
| `slots.min` | `1` | built-in | lowest port slot number |
| `slots.max` | `9` | built-in | highest port slot number |
| `slots.port_base` | `4000` | built-in | first port of slot 0 |
| `slots.ports_per_slot` | `10` | built-in | ports reserved per worktree |
| `notifiers` | `[{"adapter":"os"}]` | built-in | how you are told about new inbox items |

## You (usually in the user file)

| Setting | Value | From | What it does |
|---|---|---|---|
| `agents.claude` | `{"adapter":"claude","args":["--permission-mode","auto"]}` | built-in | a coding agent norn can brief or start |
| `default_agent` | `claude` | built-in | agent for steps that do not name one |
| `default_mode` | `manual` | built-in | who starts unattended steps of a story with no mode set: manual (you) or auto (the tick) |

## The team (usually in the repo file)

| Setting | Value | From | What it does |
|---|---|---|---|
| `remote.provider` | `gh` | repo | where stories come from: gh or glab |
| `remote.label` | `norn` | repo | issues assigned to you with this label become stories |
| `remote.git_remote` | `origin` | built-in | git remote to push and fetch |
| `remote.sync_interval` | `5m` | built-in | how often watch looks for new issues |
| `base_branch` | the remote's default branch | built-in | branch stories are cut from and PR'd into |
| `default_workflow` | `story` | built-in | workflow for a new story |
| `default_slice_workflow` | `slice` | built-in | workflow for a new slice |
| `watch_interval` | `30s` | built-in | time between ticks of norn watch |
| `claim.lease` | `10m` | built-in | a claim not renewed for this long is free to take |
| `claim.renew` | `3m` | built-in | how often the holder renews its claim |
| `limits.deadline` | `60m` | built-in | unattended step runs this long, then times out |
| `limits.nudges` | `2` | built-in | nudges into the same session before giving up |
| `limits.retries` | `1` | built-in | fresh sessions after an agent died |
| `limits.stalled` | `15m` | built-in | no activity for this long counts as stalled |
| `limits.attended_wait` | `2m` | built-in | an attended run idle this long shows as Your turn |

## Notes

- `agents.claude` passes `--permission-mode`: that is the agent's own permission mode, not norn's `default_mode`.
exit 0

$ norn config set --help
norn config set — Set one value in the user or repo config file

    norn config set <key> <value> [--user|--repo] [--json]

Options
  --user  edit ~/.norn/config.yaml (yours, this machine)
  --repo  edit .agents/norn.config.yaml (the team's, committed)

For the person; an agent runs it only when the person asks it to.

$ norn config set --repo default_mode auto
Set `default_mode` to `auto` in the repo file (`.agents/norn.config.yaml`).
exit 0

$ grep default_mode .agents/norn.config.yaml
51:# default_mode: manual
88:default_mode: auto

$ norn config list --json (files)
{"files":{"user":{"path":"/Users/jakubpruszynski/.norn/config.yaml","exists":true},"repo":{"path":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa-repo-7ZnJ/.agents/norn.config.yaml","exists":true}},"entries":[{"key":"agents.claude","value":{"adapter":"claude","args":["--permission-mode","auto"]},"source":"built-in","group":"person","meaning":"a coding agent norn can brief or start"},{"key":"default_agent","value":"claude","source":"built-in","group":"person","meaning":"agent for steps that do not name one"},{"key":"runner","value":{"adapter":"herdr"},"source":"user","group":"machine","meaning":"starts agents in auto mode; none: every story runs manual"},{"key":"remote.provider",

$ norn story create --title Nope --workflow nope --json
{"error":"no workflow 'nope' in .agents/workflows/ (available: bug, slice, story)","do_instead":"norn story create --title \"…\" --workflow <bug|slice|story>","code":"unknown_workflow","details":{"workflows":["bug","slice","story"]}}
exit 3

$ norn doctor --json (paths named)
.agents/norn.config.yaml
.agents/skills
.agents/workflows/bug.yaml
.agents/workflows/slice.yaml
.agents/workflows/story.yaml

$ ls -d .agents/norn
ls: .agents/norn: No such file or directory
