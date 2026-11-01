# AC6 — pass (qa#1's F1 is fixed)
Throwaway repo $TMPDIR/qa71b (fake gh), story gh-12 a finished triage round (see AC8).
- Label 'norn' removed → `norn sync` (remote.mirror) → two plain `norn tick`s (story.round_done): state stays $done/done, park null; `norn status` shows the Check item "gh-12: remote: label 'norn' removed — the round stays finished" after the sync AND after the plain ticks (qa#1 lost it there). It comes from machine-local issue.json. AC6.txt.
- Label back, issue unassigned → sync + tick: not parked, Check item "remote: issue unassigned — the round stays finished". AC6.txt.
- Issue gone from the remote (unseen) → sync + tick: not parked, Check item "remote: issue closed, unassigned or unlabelled — the round stays finished". AC6-unseen.txt.
- Unfinished round + closed issue parks; PR closed unmerged parks under GR7: unit tests (AC1-7.md).
