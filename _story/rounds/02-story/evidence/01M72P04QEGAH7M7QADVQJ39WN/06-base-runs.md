## 06.AC2/AC3 fixture: 0.30.0 repo; packages/view/test/integration/fixtures/gh-1/spec (an older norn's finished story with runs/) copied to .agents/specs/gh-1-projects-and-items on main, committed
files under runs/: 32
$ norn status
Inbox empty — nothing needs you.

exit=0  repo+machine-dir changed: no

$ norn status --json
{"at":"2026-11-10T12:21:18.600Z","groups":{"your_turn":[],"answer":[],"approve":[],"unblock":[],"check":[],"unclaimed":[],"running":[],"notes":[],"recently_done":[]},"pending":0,"delegated_counts":{},"heartbeat":{"holder":"jakubpruszynski@mac","last_tick_at":null,"age":null,"down":false,"up":false}}

exit=0  repo+machine-dir changed: no

status mentions of runs/ / base tree / run state: 0 (json), 0 (markdown)
$ norn run list gh-1 --json
{"unit":"gh-1","story":"gh-1","slice":null,"title":"Projects and items","status":"not_started","step":null,"intake_at":"2026-10-23T16:10:41.142Z","done_at":null,"merged_at":null,"totals":{"wall_clock_ms":1541438839,"merge_wait_ms":null,"by_type":{},"by_step":{},"human_wait_ms":0},"steps":[],"units":[{"unit":"gh-1","story":"gh-1","slice":null,"title":"Projects and items","status":"not_started","step":null,"intake_at":"2026-10-23T16:10:41.142Z","done_at":null,"merged_at":null,"totals":{"wall_clock_ms":1541438839,"merge_wait_ms":null,"by_type":{},"by_step":{},"human_wait_ms":0}},{"unit":"gh-1/03","story":"gh-1","slice":"gh-1/03","title":"Web UI — project sidebar and project management","status":"not_started","step":null,"intake_at":null,"done_at":null,"merged_at":null,"totals":{"wall_clock_ms":null,"merge_wait_ms":null,"by_type":{},"by_step":{},"human_wait_ms":0}}],"hidden_events":0,"rounds":[],"records":{"source":"machine","root":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa6-gh317/home/repos/br-de080613/runs/gh-1"},"total":0}

exit=0  repo+machine-dir changed: no

## 06.AC3: doctor
doctor  --json repo keys: ok,version,skills,workflows,config | top: ok,live,hook_command,machine,git,agents,remote,labels,runner,skills,repo,warnings,hints
  matches /run.?state|runs\//i --json: 0, markdown: 0
doctor --repo --json repo keys: ok,version,skills,workflows,config | top: ok,repo
  matches /run.?state|runs\//i --json: 0, markdown: 0
### doctor --repo markdown
norn doctor: every check passes

  ok   norn           0.30.0 matches this repo's norn version 0.30.0
  ok   workflows      quick, refinement, reproduce, slice, story, triage valid (.agents/workflows/)
  ok   config         .agents/norn.config.yaml
HEAD unchanged: yes; porcelain lines: 0; runs/ still there: yes
