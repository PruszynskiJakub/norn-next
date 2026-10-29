import json, os
D = os.environ["D"]
c = json.load(open(f"{D}/criteria.json"))
notes = {"B36": "prompt says 'Worktrees for 1 units' (plural with 1)", "B52": "headless fake runner; under Herdr cancel closes the pane (ruling gh-75/09)", "B13": "no notice under --json on a first run; stdout unaffected", "B63": "setting agents.claude.model in the repo file writes the whole agents.claude entry (adapter, args)", "B28": "Herdr tab path observed through a runner that can open terminals (fake)", "B70": "mid-workflow continuation rests on unchanged schemas (comments only) and the pinned golden/transcript suites"}
rows = ["| Criterion | Verdict | Evidence | Note |", "|---|---|---|---|"]
for o in c:
    ev = o.get("evidence", "").replace(D + "/", "")
    rows.append(f"| {o['id']} | {o['verdict']} | {ev} | {notes.get(o['id'], o.get('reason', ''))} |")
hdr = f"""# QA gh-75 qa#3 on HEAD

Evidence root: {D}
- ev/: the branch's real CLI (`bun packages/cli/src/main.ts`, HERDR_*/NORN_* unset) in a throwaway repo with a local bare remote ({D}/r); released 0.11.1 run side by side for comparisons.
- e1/, e3/, e69/, ec/: drivers ({D}/qa.ts, qa3.ts, b69.ts, qa-cockpit.ts, qa-start.ts, qa-team.ts, qa-view.ts) running runCli against the integration harness (real git, fake remote/runner/clock/terminal).
- Full suite: {D}/suite.txt.

63 pass · 1 person (B19) · 7 unverified (B12, B29, B46, B47 need herdr; B17 browser; B18 remote; B23 browser+remote) · 0 fail.

"""
open(f"{D}/report.md", "w").write(hdr + "\n".join(rows) + "\n")
