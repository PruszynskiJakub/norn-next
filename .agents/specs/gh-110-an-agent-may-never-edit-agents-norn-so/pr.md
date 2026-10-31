## Summary

Committed and machine-local norn files no longer share `.agents/norn/`: the repo config and workflows become ordinary repo files an agent may change in a step, the checkout's trace moves to `~/.norn/repos/<id>/`, `norn doctor` validates workflows and config before they merge, and `norn migrate` moves an old-layout repository over. On the old layout every other command refuses and names `norn migrate`.

```text
before                              after
.agents/norn/config.yaml       →    .agents/norn.config.yaml        # committed, editable in a step
.agents/norn/workflows/*.yaml  →    .agents/workflows/*.yaml        # committed, editable in a step
.agents/norn/trace/            →    ~/.norn/repos/<name>-<hash8>/   # machine-local, outside the working tree and .git
                                    (hash8 = sha256(realpath of git common dir)[:8])
```

```text
runCli
  locate repo
  layout guard (main checkout only)   # old → refused old_layout, do_instead: norn migrate
                                      # both → refused both_layouts, naming each pair
                                      # exempt: migrate, doctor (reports it), help; hook exits 0
  command
```

`scripts/smoke.sh` (run by CI on the npm package and each binary) now checks that `norn init` writes the new layout and no `.agents/norn/`.

**Release note:** after `norn migrate`, an older norn cannot read the repository: upgrade norn to this release or later on every machine that works on it. There is no compatibility path.

## Evidence

All observed by QA (qa#2, at `1250d28c`; nothing but norn's own commits since) with the dev build in throwaway repos (isolated `NORN_HOME_DIR`, scripted `gh`). Full suite 1528 pass / 0 fail, typecheck clean ([suite](https://github.com/PruszynskiJakub/norn-next/blob/gh-110-an-agent-may-never-edit-agents-norn-so/.agents/specs/gh-110-an-agent-may-never-edit-agents-norn-so/runs/_story/evidence/01M67QXW1BVWV9FK6TN1AVDNFQ/suite.txt)). `scripts/smoke.sh` on the built package: smoke ok ([smoke](https://github.com/PruszynskiJakub/norn-next/blob/gh-110-an-agent-may-never-edit-agents-norn-so/.agents/specs/gh-110-an-agent-may-never-edit-agents-norn-so/runs/_story/evidence/01M67QXW1BVWV9FK6TN1AVDNFQ/ruling-smoke.txt)); this PR's CI at that head: check, process, plan, package, build and all three smoke jobs green ([CI](https://github.com/PruszynskiJakub/norn-next/blob/gh-110-an-agent-may-never-edit-agents-norn-so/.agents/specs/gh-110-an-agent-may-never-edit-agents-norn-so/runs/_story/evidence/01M67QXW1BVWV9FK6TN1AVDNFQ/ruling-ci.json)).

- **B1** config at `.agents/norn.config.yaml`
  **Before:** `.agents/norn/config.yaml`
  **After:** `norn init` writes `.agents/norn.config.yaml`, no `.agents/norn/`; `norn config list` names it as the repo source ([evidence](https://github.com/PruszynskiJakub/norn-next/blob/gh-110-an-agent-may-never-edit-agents-norn-so/.agents/specs/gh-110-an-agent-may-never-edit-agents-norn-so/runs/_story/evidence/01M67QXW1BVWV9FK6TN1AVDNFQ/B1-B2-init.txt))
- **B2** workflows in `.agents/workflows/`
  **Before:** `.agents/norn/workflows/`
  **After:** init writes `bug`, `slice`, `story` there; a story labelled `norn:wf:quick` pinned `.agents/workflows/quick.yaml` ([init](https://github.com/PruszynskiJakub/norn-next/blob/gh-110-an-agent-may-never-edit-agents-norn-so/.agents/specs/gh-110-an-agent-may-never-edit-agents-norn-so/runs/_story/evidence/01M67QXW1BVWV9FK6TN1AVDNFQ/B1-B2-init.txt), [pinned](https://github.com/PruszynskiJakub/norn-next/blob/gh-110-an-agent-may-never-edit-agents-norn-so/.agents/specs/gh-110-an-agent-may-never-edit-agents-norn-so/runs/_story/evidence/01M67QXW1BVWV9FK6TN1AVDNFQ/B2-quick-pinned.txt))
- **B3** agent may edit workflows and config
  **Before:** the norn skill forbade anything in `.agents/norn/`
  **After:** the shipped skill forbids only `runs/` and the generated top of handoff.md, and names the workflows and config as ordinary repo files ([evidence](https://github.com/PruszynskiJakub/norn-next/blob/gh-110-an-agent-may-never-edit-agents-norn-so/.agents/specs/gh-110-an-agent-may-never-edit-agents-norn-so/runs/_story/evidence/01M67QXW1BVWV9FK6TN1AVDNFQ/B3-B22-docs.txt))
- **B4** running units keep their pinned workflow (S7)
  **Before:** same
  **After:** `quick.yaml` edited on main after gh-1 started: gh-1's copy unchanged, gh-3 started later pinned the edit ([evidence](https://github.com/PruszynskiJakub/norn-next/blob/gh-110-an-agent-may-never-edit-agents-norn-so/.agents/specs/gh-110-an-agent-may-never-edit-agents-norn-so/runs/_story/evidence/01M67QXW1BVWV9FK6TN1AVDNFQ/B4-pinning.txt))
- **B5** machine-local files in `~/.norn/repos/<id>/`
  **Before:** `.agents/norn/trace/` in the working tree, gitignored
  **After:** after ticks, heartbeat, day trace, caches, hooks and `checkout.json` are in `<home>/repos/repo-deabb63b/` (id recomputed by hand); a second clone got its own dir; `git status --short --ignored` shows nothing of norn's ([evidence](https://github.com/PruszynskiJakub/norn-next/blob/gh-110-an-agent-may-never-edit-agents-norn-so/.agents/specs/gh-110-an-agent-may-never-edit-agents-norn-so/runs/_story/evidence/01M67QXW1BVWV9FK6TN1AVDNFQ/B5-tick-machine-dir.txt))
- **B6** `~/.norn/` otherwise unchanged
  **After:** `config set --user` writes `<home>/config.yaml` beside `repos/` and is read back as user ([evidence](https://github.com/PruszynskiJakub/norn-next/blob/gh-110-an-agent-may-never-edit-agents-norn-so/.agents/specs/gh-110-an-agent-may-never-edit-agents-norn-so/runs/_story/evidence/01M67QXW1BVWV9FK6TN1AVDNFQ/B6-user-config.txt))
- **B7** doctor validates every workflow (W5)
  **Before:** a broken workflow was found only by a tick on the main checkout, after merge
  **After:** an uncounted cycle and a missing skill each FAIL naming file, step path and cause, exit 1 ([evidence](https://github.com/PruszynskiJakub/norn-next/blob/gh-110-an-agent-may-never-edit-agents-norn-so/.agents/specs/gh-110-an-agent-may-never-edit-agents-norn-so/runs/_story/evidence/01M67QXW1BVWV9FK6TN1AVDNFQ/B7-doctor-broken-workflow.txt))
- **B8** doctor validates the repo config
  **Before:** did not exist
  **After:** an invalid `.agents/norn.config.yaml` → FAIL naming the file and the schema path, exit 1 ([evidence](https://github.com/PruszynskiJakub/norn-next/blob/gh-110-an-agent-may-never-edit-agents-norn-so/.agents/specs/gh-110-an-agent-may-never-edit-agents-norn-so/runs/_story/evidence/01M67QXW1BVWV9FK6TN1AVDNFQ/B8-doctor-broken-config.txt))
- **B9** doctor changes nothing
  **After:** `doctor --repo` and plain `doctor` both leave `git status` clean ([repo](https://github.com/PruszynskiJakub/norn-next/blob/gh-110-an-agent-may-never-edit-agents-norn-so/.agents/specs/gh-110-an-agent-may-never-edit-agents-norn-so/runs/_story/evidence/01M67QXW1BVWV9FK6TN1AVDNFQ/B9-B10-doctor-repo-valid.txt), [full](https://github.com/PruszynskiJakub/norn-next/blob/gh-110-an-agent-may-never-edit-agents-norn-so/.agents/specs/gh-110-an-agent-may-never-edit-agents-norn-so/runs/_story/evidence/01M67QXW1BVWV9FK6TN1AVDNFQ/B9-doctor-full.txt)); plain doctor's exit 1 there is an unrelated machine check (claude hooks never fired in a throwaway repo)
- **B10** `doctor --repo` needs no agent, runner or remote
  **Before:** did not exist
  **After:** with no `claude`/`gh` on PATH and no token: layout, workflows, config only, exit 0; broken workflow → exit 1 ([valid](https://github.com/PruszynskiJakub/norn-next/blob/gh-110-an-agent-may-never-edit-agents-norn-so/.agents/specs/gh-110-an-agent-may-never-edit-agents-norn-so/runs/_story/evidence/01M67QXW1BVWV9FK6TN1AVDNFQ/B9-B10-doctor-repo-valid.txt), [broken](https://github.com/PruszynskiJakub/norn-next/blob/gh-110-an-agent-may-never-edit-agents-norn-so/.agents/specs/gh-110-an-agent-may-never-edit-agents-norn-so/runs/_story/evidence/01M67QXW1BVWV9FK6TN1AVDNFQ/B7-doctor-broken-workflow.txt)). Wiring it into this repo's CI is deferred to the follow-up that migrates this repo (D14).
- **B11** migrate stages git moves, no commit
  **Before:** did not exist
  **After:** staged renames for config and each workflow, HEAD unchanged, output ends with the commit to make ([evidence](https://github.com/PruszynskiJakub/norn-next/blob/gh-110-an-agent-may-never-edit-agents-norn-so/.agents/specs/gh-110-an-agent-may-never-edit-agents-norn-so/runs/_story/evidence/01M67QXW1BVWV9FK6TN1AVDNFQ/B11-B13-migrate.txt))
- **B12** migrate carries the machine-local files
  **After:** heartbeat id `01M60ABCDEFGHJKMNPQRSTVWXY` moved to the machine dir and kept by the next tick; claims taken under it before migrate are still recognised as this checkout's ([heartbeat](https://github.com/PruszynskiJakub/norn-next/blob/gh-110-an-agent-may-never-edit-agents-norn-so/.agents/specs/gh-110-an-agent-may-never-edit-agents-norn-so/runs/_story/evidence/01M67QXW1BVWV9FK6TN1AVDNFQ/B12-heartbeat-carried.txt), [claims](https://github.com/PruszynskiJakub/norn-next/blob/gh-110-an-agent-may-never-edit-agents-norn-so/.agents/specs/gh-110-an-agent-may-never-edit-agents-norn-so/runs/_story/evidence/01M67QXW1BVWV9FK6TN1AVDNFQ/B12-claims-carried.txt))
- **B13** migrate drops the old `.gitignore` line
  **After:** `.agents/norn/trace/` dropped and staged, the person's own line kept ([evidence](https://github.com/PruszynskiJakub/norn-next/blob/gh-110-an-agent-may-never-edit-agents-norn-so/.agents/specs/gh-110-an-agent-may-never-edit-agents-norn-so/runs/_story/evidence/01M67QXW1BVWV9FK6TN1AVDNFQ/B11-B13-migrate.txt))
- **B14** migrate twice is a no-op
  **After:** "nothing to move", exit 0, staged set unchanged ([evidence](https://github.com/PruszynskiJakub/norn-next/blob/gh-110-an-agent-may-never-edit-agents-norn-so/.agents/specs/gh-110-an-agent-may-never-edit-agents-norn-so/runs/_story/evidence/01M67QXW1BVWV9FK6TN1AVDNFQ/B14-migrate-rerun.txt))
- **B15** migrate refuses under a held tick lock
  **After:** refused `tick_locked`, do_instead stop `norn watch` and rerun, exit 3, nothing moved ([evidence](https://github.com/PruszynskiJakub/norn-next/blob/gh-110-an-agent-may-never-edit-agents-norn-so/.agents/specs/gh-110-an-agent-may-never-edit-agents-norn-so/runs/_story/evidence/01M67QXW1BVWV9FK6TN1AVDNFQ/B15-migrate-lock-held.txt))
- **B16** migrate refuses in a unit worktree
  **After:** refused `not_main_checkout`, do_instead `cd <main checkout> && norn migrate`, exit 3 ([evidence](https://github.com/PruszynskiJakub/norn-next/blob/gh-110-an-agent-may-never-edit-agents-norn-so/.agents/specs/gh-110-an-agent-may-never-edit-agents-norn-so/runs/_story/evidence/01M67QXW1BVWV9FK6TN1AVDNFQ/B16-migrate-in-worktree.txt))
- **B17** both layouts refused
  **After:** migrate, status, tick, init refused `both_layouts` naming both paths, exit 3, nothing moved ([evidence](https://github.com/PruszynskiJakub/norn-next/blob/gh-110-an-agent-may-never-edit-agents-norn-so/.agents/specs/gh-110-an-agent-may-never-edit-agents-norn-so/runs/_story/evidence/01M67QXW1BVWV9FK6TN1AVDNFQ/B17-both-layouts.txt))
- **B18** old layout refused, names `norn migrate`
  **After:** status, tick, watch, brief refused `old_layout`, exit 3; with `--json` a `CliError` ([evidence](https://github.com/PruszynskiJakub/norn-next/blob/gh-110-an-agent-may-never-edit-agents-norn-so/.agents/specs/gh-110-an-agent-may-never-edit-agents-norn-so/runs/_story/evidence/01M67QXW1BVWV9FK6TN1AVDNFQ/B18-B19-B20-old-layout.txt))
- **B19** init refuses on the old layout
  **After:** refused `old_layout`, exit 3, nothing written ([evidence](https://github.com/PruszynskiJakub/norn-next/blob/gh-110-an-agent-may-never-edit-agents-norn-so/.agents/specs/gh-110-an-agent-may-never-edit-agents-norn-so/runs/_story/evidence/01M67QXW1BVWV9FK6TN1AVDNFQ/B18-B19-B20-old-layout.txt))
- **B20** doctor reports the old layout
  **After:** FAIL layout "old layout", lists the old parts, → `norn migrate`, exit 1, nothing moved ([evidence](https://github.com/PruszynskiJakub/norn-next/blob/gh-110-an-agent-may-never-edit-agents-norn-so/.agents/specs/gh-110-an-agent-may-never-edit-agents-norn-so/runs/_story/evidence/01M67QXW1BVWV9FK6TN1AVDNFQ/B18-B19-B20-old-layout.txt))
- **B21** old files in a unit worktree are ignored
  **After:** with the main checkout migrated, worktrees still holding (invalid) `.agents/norn/config.yaml`: brief, hook, ask, done all exit 0; hook facts land in the machine dir ([evidence](https://github.com/PruszynskiJakub/norn-next/blob/gh-110-an-agent-may-never-edit-agents-norn-so/.agents/specs/gh-110-an-agent-may-never-edit-agents-norn-so/runs/_story/evidence/01M67QXW1BVWV9FK6TN1AVDNFQ/B21-worktree-old-files.txt))
- **B22** docs and help describe the new layout
  **After:** README, PRD, shipped skills and config name the new paths; `norn help` lists `migrate` ([evidence](https://github.com/PruszynskiJakub/norn-next/blob/gh-110-an-agent-may-never-edit-agents-norn-so/.agents/specs/gh-110-an-agent-may-never-edit-agents-norn-so/runs/_story/evidence/01M67QXW1BVWV9FK6TN1AVDNFQ/B3-B22-docs.txt)). AGENTS.md's Process and CONTRIBUTING.md's lines on this repo's own files keep the old paths on purpose until the follow-up migrates this repo (D12).
- **B23** release note on upgrading
  **Not shown by QA:** only a person can judge it. The Release note paragraph above is the text the `release` step takes into the changelog (D13); check it there at the release `ready` gate. README's upgrade paragraph says the same.

## Merge danger

**Door:** two-way for the merge: code and docs only, this repo is not migrated and a revert removes it all. It becomes one-way per repository once released and someone commits a `norn migrate`: older norns can no longer read that repository.

**Blast radius:** every user, at upgrade: the release that carries this refuses every old-layout repository (status, tick, watch, brief, init) until `norn migrate` runs, and that includes this repo — installing it here stops this repo's process until `norn migrate` runs in the main checkout (the follow-up story), so plan the two together. Moving a repo folder later gives it a new machine dir; `doctor` warns and prints the `mv` that adopts the old one.
