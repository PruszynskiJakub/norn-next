# AC2 — unit folders pass under the unit guard; mixed files split
- `bun test --preload ./test/support/unit-guard-preload.ts packages/{store,adapters,view}/test/unit` → 189 pass, 0 fail, 25 files (AC2-guard.txt).
- Guard bites: same preload on packages/store/test/integration (with bunfig.integration.toml) → 27 fail of 27 (AC2-guard-bites.txt), so the unit pass is meaningful.
- Mixed files split into unit + integration halves: store refs is whole integration, worktree 3+2, snapshot 2+4, spawn 1+8, files 9+1, leases-lock 7+1; adapters git 5+12, headless 4+2, opencode 3+1, process 6+1; view steps 5+11, view 5+13.
- Note: the slice's check line names ./test/support/unit-guard.ts (the library, installs nothing); the correct preload is unit-guard-preload.ts (review note 1).
