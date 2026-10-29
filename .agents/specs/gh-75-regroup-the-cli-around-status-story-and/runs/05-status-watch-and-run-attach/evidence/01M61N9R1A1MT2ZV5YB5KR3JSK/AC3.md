# AC3 (B46) — run attach <unit>
Real CLI (no live panes in the throwaway repo):
- `run attach gh-1` → `{"error":"gh-1 has no live agent pane","do_instead":"norn status","code":"nothing_to_attach"}` exit 3
- `run attach` (no target) → `{"error":"No unit has a live agent pane","do_instead":"norn status","code":"no_target"}` exit 3
S1 test "run attach (B46, B47…)" with fake Herdr: `run attach gh-5` → exit 0 `{unit:"gh-5",focused:"w9:p5"}`, fake records `focus w9:p5`; pane gone → exit 3 nothing_to_attach with do_instead containing the unit's start command (worktree path); gh-6 (an Answer item, no pane) → nothing_to_attach naming gh-6; outside Herdr → nothing_to_attach; no target interactively offers only `["gh-5"]` (the unit with a live pane); a script without a target → exit 2 target_required, do_instead `norn run attach gh-5`. Green.
