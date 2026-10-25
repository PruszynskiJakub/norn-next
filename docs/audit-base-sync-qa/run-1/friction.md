# Friction and defects — sync-qa dogfood (impl-base-sync-qa @ 078b513)

Ranked by impact on a person. Evidence paths are relative to this directory.

## C1 — `norn inbox` never shows PR-derived items: the BS10 Merge item and the BS11 retarget item (HIGH)
`packages/view/src/load.ts:316` builds every story with `pr: undefined`, so `mergeItem()` (`packages/core/src/inbox.ts:258`) returns null in the CLI view. gh-37 was `$done` with PR #38 open, 17–18 behind and conflicting: `norn inbox` showed it only under "Recently done — workflow done, waiting for the PR merge (GR6)" with `norn trace`, never "Merge PR #38 … behind main by 17 · conflicts … — update the story first / norn update gh-37" (polled 9× over 70 s: c-inbox-merge-item-poll.txt). The tick-side inbox *does* compute it correctly, but PR facts exist only on sync ticks (every 4th tick at sync_interval 1m / watch 15s), so the item appears and is resolved ("no longer pending") once per minute (C trace: `grep merge:gh-37`). Same for the retarget Check item "PR #38 targets release-sandbox, not main" (c-retarget-item.txt). Net: the person is never told in the inbox that a done story conflicts with its base, nor that a PR targets the wrong branch — the two BS10/BS11 items meant for exactly that. `norn update` itself works once you know to run it.
Fix direction: keep the last PR fact per story (like `base.json` keeps base facts) and use it in observe on non-sync ticks and in the view.

## C2 — A QA agent passes an unobserved criterion on the strength of an earlier gate ruling (HIGH for QV's promise)
gh-41 qa#2 (after `norn update` from ready, base merge changed the footer) reported `pass` with AC2 (`needs: [browser]`) verdict `pass`, evidence "No browser in this session. Settled by person ruling gh-41 human-qa#1 … 'AC2 accepted'", and a note saying so (gh41-qa2-pass-receipt.json). The brief's "Rulings" section tells the agent the person's gate comments "settle the questions they answer … do not raise them again", which beats the qa skill's "never pass what you did not observe". `norn done` cannot tell (pass + any evidence string is valid), so the story skipped human-qa on code the person never saw (the ruling was about a pre-merge footer). gh-37 qa#3 faced the same kind of ruling and stayed `unverified` — so it is model-dependent. Options: a `person` verdict carried over explicitly (e.g. verdict `person` with `ruling: <receipt>`), or rulings in the qa brief scoped out of criteria verdicts; at least the brief should say rulings never turn a criterion into `pass`.

## C3 — `base_conflict_loop` / `stale_loop` count across independent base moves; a busy base will park stories (MED)
Counters never reset (W4). gh-37 had two unrelated conflicts (after merge 1 and merge 2) and finished at `base_conflict_loop 2/2`; one more sibling merge touching the same file would have exhausted it → `$stuck`, although each resolve succeeded first time. In a sprint with 5 stories on one file this is the normal case, not a loop. The counter should bound attempts per base sha (or reset when `update` reports `done`).

## C4 — Agent commits during an implicit ask are reported as foreign (MED)
B's resolve#1 committed the merge (26476f6 "Merge main into gh-36: …") while the unit was parked on a Claude permission prompt (implicit ask). `foreignCommits` runs only when the unit is not `running`, so the agent's own merge commit was traced as `foreign_commits` (B trace 15:33:42Z) and shows as "foreign commit … (not made by norn)". The norn `update` merge commits (54f0c82, 70204f3, Norn-Tick) were correctly not reported. Headless C (no parks) had no false positive.

## C5 — Old ready-approval head pin fires "head changed after ready approval" during the re-run after `norn update` (LOW)
After `norn update gh-37` from `$done`, every new head produced a Check item "PR #38 head changed after ready approval (2e4efdc → …)" (c-head-changed-items.txt) although BS9 voids that approval (ready must be passed again). Tick-side only (C1 hides it from `norn inbox`).

## C6 — `max_agents` is a machine cap the repo layer can only lower (LOW, simulation limit)
With three "machines" on one Mac sharing ~/.norn leases, the default user-layer cap 2 queued gh-35 ("queued: max_agents 2 in use (K1)") even though the repo config said 3. Worked around with ~/.norn/config.yaml `max_agents: 3` (removed at the end). Correct per K2, but the queued reason could say the cap comes from the user layer.

## C7 — Implicit ask for an MCP permission captures no options (LOW)
gh-36 qa on B (herdr, interactive Claude with my global MCP servers): "Claude in Chrome wants to create a browser window and read your tabs — 1. Allow / 2. Deny". The ask receipt has `question: "Claude needs your permission"` and the command, but no `options`, so the inbox says `norn answer gh-36 "…"` without the numbers (b-pane-chrome-ask.txt). Also worth knowing for QV6: on B a browser capability *exists* via MCP; whether `unverified` happens depends on a permission prompt, not on the runner.

## C8 — Fresh checkouts show a stale "Approve gh-18 ready" item with a path that does not exist (LOW, B10-like)
C (fresh clone) and B list "Approve gh-18 ready" (an unmerged story from an earlier run, unclaimed) with a receipt path under *their own* worktrees dir, where no gh-18 worktree exists (snaps/01-gh37-human-qa/C/inbox.txt).

## C9 — Agents edit the repo-root `handoff.md`, which then conflicts on base merges (LOW, sandbox/skill)
The sandbox has a tracked root `handoff.md`; agents append QA/review summaries to it (e.g. d75947b), so it conflicted in gh-36's first base merge (classify 0029: "conflicts: handoff.md, src/web.ts, …"). Not a norn-core defect, but the skills could say the handoff lives under runs/.

## Not defects, notes
- `norn trace` does not show the `update` receipt (`norn update` from `$done`) as a row: the timeline jumps from `ready#1 approve` to `update#2`. From a gate it shows `ready#1 … update` as the outcome.
- `norn update` refusals are clear: `story_not_local` (other checkout), `story_merged` (merged story).
- My own tool slip: startwatch.sh lost A/C watches on an unquoted PATH at the first start (restarted 34 s later).
