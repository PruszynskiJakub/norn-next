Full suite 1437/1437 pass (suite.txt), typecheck green (typecheck.txt).

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| AC1 (B5) | pass | AC1.md | test + hand: repos/app-f8c1edd7 (hash checked independently), tick.lock seen there, tree/.git clean, no trace ignore line |
| AC2 (B5) | pass | AC2.md | test (hook/brief/tick from unit worktree) + hand tick from a linked worktree |
| AC3 (B5) | pass | AC3.md | two clones → two dirs, two heartbeat ids |
| AC4 (B6) | pass | AC4.md | user config read from home/config.yaml; leases dir unchanged (test reads slot lease back) |
| AC5 (B5) | pass | AC5.md, AC5-doctor.md | warned, moved nothing; printed command run by hand adopts heartbeat + rewrites checkout.json |
| AC6 (B5) | pass | AC6.md, AC6-doctor.md, home-tree-final.txt | headless logs in repos/<id>/runs/ |

Side observation (not a criterion): doctor's "hooks fire" check reported "not firing" in 2 of 6 runs in the scratch repo (first runs), then fired in 4 consecutive runs.
