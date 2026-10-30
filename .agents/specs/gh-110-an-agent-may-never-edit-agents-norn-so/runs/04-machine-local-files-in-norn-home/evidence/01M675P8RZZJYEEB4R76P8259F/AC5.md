# AC5: doctor warns about an orphaned machine dir
- Test: machine-dir.test.ts AC5 passes (runs the printed command in sh, ticks, orphan heartbeat kept).
- By hand: made home/repos/app-0badc0de with checkout.json → ".../w/old place/app" (missing) and heartbeat 01J000…; `norn doctor` (AC5-doctor.md line 16):
  "! orphaned machine dir …/repos/app-0badc0de: its checkout …/old place/app no longer exists — if this repo moved from there, stop norn watch and adopt it (keeps its heartbeat and claims): rm -rf …/repos/app-f8c1edd7 && mv …/repos/app-0badc0de …/repos/app-f8c1edd7"
  - Home file list before/after doctor identical (moved nothing).
  - Ran the printed command by hand, then tick: repos/app-f8c1edd7 now has heartbeat_id 01J00000000000000000000000 (adopted) and checkout.json rewritten to this checkout.
- Doctor exit 1 here comes from the remote check (no origin in the scratch repo), unrelated.
