# gh-110 qa #2 — at HEAD 1250d28c

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| B1 | pass | B1-B2-init.txt | |
| B2 | pass | B1-B2-init.txt, B2-quick-pinned.txt | |
| B3 | pass | B3-B22-docs.txt | |
| B4 | pass | B4-pinning.txt | |
| B5 | pass | B5-tick-machine-dir.txt | id recomputed by hand; second clone gets its own dir |
| B6 | pass | B6-user-config.txt | |
| B7 | pass | B7-doctor-broken-workflow.txt | |
| B8 | pass | B8-doctor-broken-config.txt | |
| B9 | pass | B9-B10-doctor-repo-valid.txt, B9-doctor-full.txt | full doctor exit 1 only for an unrelated machine check (claude hooks not firing in a throwaway repo) |
| B10 | pass | B9-B10-doctor-repo-valid.txt, B7-doctor-broken-workflow.txt | CI wiring deferred (D14) |
| B11 | pass | B11-B13-migrate.txt | |
| B12 | pass | B12-heartbeat-carried.txt, B12-claims-carried.txt | claims taken under H recognised after migrate |
| B13 | pass | B11-B13-migrate.txt | |
| B14 | pass | B14-migrate-rerun.txt | |
| B15 | pass | B15-migrate-lock-held.txt | |
| B16 | pass | B16-migrate-in-worktree.txt | |
| B17 | pass | B17-both-layouts.txt | |
| B18 | pass | B18-B19-B20-old-layout.txt | |
| B19 | pass | B18-B19-B20-old-layout.txt | |
| B20 | pass | B18-B19-B20-old-layout.txt | |
| B21 | pass | B21-worktree-old-files.txt | |
| B22 | pass | B3-B22-docs.txt | AGENTS/CONTRIBUTING process lines old on purpose (D12) |
| B23 | person | PR #121 body line 22 | release note present; confirm at ready / release gate |

Ruling (ready#1 reject, CI package job): scripts/smoke.sh now checks .agents/norn.config.yaml and .agents/workflows/; `bun scripts/build.ts` + `scripts/smoke.sh dist/npm/norn.js 0.12.1` → smoke ok (ruling-smoke.txt). PR #121 CI at head 1250d28c: check, process, plan, package, build and all three smoke jobs SUCCESS (ruling-ci.json).

Setup: dev build `bun packages/cli/src/main.ts` in throwaway repos under $TMPDIR/qa2-gh110 cloned from bare remotes, NORN_HOME_DIR=$TMPDIR/qa2-gh110/home, a scripted `gh` on PATH serving issues from issues.json; the B15 lock was held by a live process via store acquireLock at the old tick-lock path. Old-layout repos were made by `init`, then moving the files and the machine dir back to the old places.

Suite: bun test 1528 pass, 0 fail (97 files); typecheck exit 0 (suite.txt).
