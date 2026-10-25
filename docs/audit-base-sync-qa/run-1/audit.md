# Independent audit: sync-qa dogfood of `impl-base-sync-qa` @ 078b513

Scope: the driver's run of `.agents/SPEC-base-sync-and-qa.md` (Part A BS0–BS11; Part B QV1–QV8, NT1–NT4) on three sandbox checkouts, issues #35–#37 and #41, PRs #38–#40 and #42.
Sources: the git history of `PruszynskiJakub/norn-sandbox-todoist` (fetched after the run), the receipts committed on the story branches, traces in `traces/{A,B,C}`, the snapshots in `snaps/`, and the norn source at 078b513.
Every evidence path below is relative to `sync-qa-run/`. New evidence gathered for this audit is in `audit-evidence/`.

**Summary.** Base sync works end to end. Three stories that touched the same footer line were merged one by one. Each story whose base moved went through update → conflict → resolve → update → test → qa without a person merging anything. All three footer fields reached main. The QA verdict gate refuses what it should.

The audit found one defect the driver missed and widened two others:

- **norn committed conflict markers itself.** When the gh-36 resolve agent parked on a permission prompt mid-merge, norn's own "waits for input" commit concluded the merge with markers in `src/web.ts`, the footer test and `handoff.md`. It pushed that commit with a `Norn-Tick` trailer, and the commit is now in main's history (ac87fb7).
- **The head-changed item is a false positive on every ready approval.** It fires on all three stories, not only after `norn update`.
- **The final main does not meet AC3.** No session or person ever observed AC3, and this audit measured that the footer wraps.

## 1. Scenario verdicts and pass criteria

| Item | Driver | Audit | Evidence and reasoning |
|---|---|---|---|
| S1: three stories in parallel reach human-qa | works | **CONFIRMED**, with a caveat | gh-35, gh-36 and gh-37 all reached human-qa through `unverified` (receipts `0012-done` on each branch). Caveat: on the headless checkouts (A, C), part of the reason for `unverified` was the permission allowlist. `PORT=… bun run src/server.ts` does not match `Bash(bun:*)` (`config-a.yaml`), so the session could not even start the server, not only "no browser" (gh-37 qa#1 reason in `snaps/01-gh37-human-qa/C/inbox.txt`; gh-41 `0012-done`: "server start was denied"). |
| S2a: a gate with a `stale` route re-enters update by itself | works | **CONFIRMED** | gh-36 human-qa: classify `0029` (stale, 17 behind, base 95f99f4) 12 s after PR #39 merged at 15:31:45Z. gh-37 human-qa#2: stale at 15:41:31Z, 22 s after PR #40 (`trace-gh37.txt`). Only the human-qa route was exercised; **the `stale` route on the `ready` gate never fired**. |
| S2b: a conflicting story runs the full loop | works | **PARTLY** | The loops ran (graph: `audit-evidence/origin-main-graph.txt`). gh-36's loop went through a corrupt intermediate state, though. Its resolve parked on an implicit ask while git was mid-merge, and norn's park commit ac87fb7 ("norn: gh-36 resolve waits for input", two parents cd8f6bc + 95f99f4, `Norn-Tick 01M5Q8PTACRG87Z27E7FBBT2Y8`) **committed and pushed `<<<<<<<`/`>>>>>>>` markers** in `src/web.ts:339-343`, `test/footer-version.test.ts:17-41` and `handoff.md:6-13` (`audit-evidence/ac87fb7-markers.txt`). The agent then fixed the markers in a single-parent commit (26476f6). See H1. |
| S2c: a done story waiting for its merge | partly | **PARTLY** (agree) | `norn update gh-37` works: receipt `0016-update {from:"$done", to:"update"}`, and the refusals `story_not_local` / `story_merged` (`norn-update-*.json`). The BS10 merge item never appears in `norn inbox` (C1). The person had to know to run `norn update` without being told. |
| P1: no person `git merge`/`rebase` in a story worktree | works | **CONFIRMED** | Every merge commit on the story branches maps to a norn update (54f0c82, 70204f3, both with `Norn-Tick`), to an agent resolve run (31f39e1, dedf1af, 4a4bc9c, each inside a running resolve), or to norn's park commit (ac87fb7, H1). The person's only commits in worktrees were the criteria frontmatter commits (8b94381, f2927a4, f4c3943, ad8092a), and norn correctly traced those as foreign. |
| P2: resolutions visible in receipts and `norn why` | works | **PARTLY** | Visible: the classify `conflict` receipts carry paths and the base sha (`0030` on gh-36, `0031` on gh-37, `0016` on gh-41), the resolve `done` receipts carry handoff text, and `why` replays match (`why-gh37-resolve.done.json`, `replay.all_match: true`). Not visible: no receipt or trace row names the resolve's merge commit. For gh-36 the receipts describe one clean "resolve done", while the git history shows norn committing markers and then a commit flagged foreign. A person reading only `norn why`/`norn trace` cannot tell. |
| P3: ready with behind == 0 | works | **CONFIRMED** | Recomputed with `git rev-list --count head..base` at each approved ready: gh-35 228dac7 vs 1856eb4 = 0, gh-36 b4204f3 vs f7b93e2 = 0, gh-37 bc94afe vs d737478 = 0, gh-41 b995d79 vs f298a74 = 0. The driver checked this with his own script that reads raw trace facts (`tools/basefacts.sh`), **not with a norn command** (M2). |
| P4: update merge commits carry `Norn-Tick` and are not foreign | works (with C4) | **PARTLY** | The two `update` merges (54f0c82, 70204f3) carry the trailer and were never reported as foreign. CONFIRMED for those. However, the only other norn-authored merge commit (ac87fb7) carries `Norn-Tick` and contains conflict markers. The trailer made it look legitimate. |
| QA refusals (QV4/QV5) | works | **CONFIRMED** | `probe-done-pass-crit-unverified.json` (`outcome_contradicts_verdicts`, matching `unverified`), `probe-done-pass-crit-missing.json` (`invalid_criteria`, missing AC2/AC3, unknown AC9). |
| unverified → human-qa with reason and how (QV6/QV7) | works | **CONFIRMED** | `snaps/01-gh37-human-qa/C/inbox.txt` shows "Criteria for a person to check: AC3 unverified (…) — how: …". |
| QA honesty under rulings | broken | **CONFIRMED, partly induced by the driver** | gh-41 `0013-approve` comment: "person: AC2 accepted", given without a browser check. qa#2 then passed AC2 citing it (`gh41-qa2-pass-receipt.json`). The cause is the brief text at `packages/core/src/brief.ts:478`. The agent's own note ("not observed in a browser") reached the ready gate detail (`snaps/13-gh41-ready2-notes/A/inbox.txt`), so NT3 partly caught it. See H3. |
| Notes NT1–NT3 | works | **CONFIRMED** | Ack on approve (`c-approve-human-qa3.json`, `gh41-ready-approve.json`), still open after reject (`gh41-ready-reject.json`). Two of the four notes were written by the driver acting as reviewer. A person's `norn done` in manual mode is recorded as `by: agent, who: claude` (gh-37 `0025-done`), so the inbox labels it a "review note" as if an agent wrote it. |
| QV8 | works | **CONFIRMED** | `trace-gh37.txt`: "criteria: 3 report(s) · 6 pass · … 3 unverified (needs: browser 3)". |
| BS10 `stale:*` Check item | works | **CONFIRMED** | `snaps/12-gh41-stale-item/A/inbox.txt`: `norn update gh-41`, unit stays at ready. |
| BS11 retarget / merge into another branch | partly | **PARTLY** (agree) | Park works: ca9dd8e "norn: gh-41 parked (remote: PR merged into release-sandbox, not main)". The retarget item is tick-side only (C1). The status text doubles the prefix (`snaps/14-gh41-bs11-park/A/status.txt`: "stuck (remote: remote: PR merged …)", from `packages/view/src/format.ts:17` plus `decide.ts:347`). |
| "All three merged, all fields kept" | works | **PARTLY** | AC1/AC2 intent: CONFIRMED. Main 2446237 renders `· N open items · D done · P projects · T due today · v…`, and the tests of all three stories are present (`git show origin/main:test/footer-version.test.ts`). AC3 intent (one line at 375 px): **NOT SUPPORTED**. Nobody observed it. All three human-qa approvals accepted it without looking ("AC3 accepted on reading of the footer text length (no browser check by me)", `trace-gh37.txt`). This audit rendered `/today` from main 4914145 in headless Chrome (`audit-evidence/render.ts`, `today-m.html`). `body` is a flex row (`src/views.ts:57`), so the footer becomes a 122 px column beside the main column, x = 378 px, about 29 lines tall, even at Chrome's minimum headless width of 500 px. At 375 px it is off-screen (`today-375.png`). AC3 fails, and it already failed before these stories because of the existing layout. |

## 2. Defects C1–C9 checked against 078b513

| # | Driver's claim | Audit |
|---|---|---|
| C1 | `norn inbox` never shows PR items | **CONFIRMED.** `packages/view/src/load.ts:316` sets `pr: undefined`, so `mergeItem` (`packages/core/src/inbox.ts:258`) and `headChangedItem` (`:431`) return null in the view. The tick-side items exist only while PR facts do. In C's trace the merge item is present on two of every four ticks (:31 and :46 each minute) and resolved "no longer pending" on the others (15:32:31Z–15:34:46Z; jq over `traces/C`). This hides the BS10 merge-item change and the BS11 retarget item. Two spec items are therefore not delivered to a person. |
| C2 | Rulings make QA pass an unobserved criterion | **CONFIRMED.** Cause: `brief.ts:478`, "These rulings settle the questions they answer, even where the spec text still says otherwise; follow them and do not raise them again", which overrides `qa/SKILL.md:84` ("Never pass what you did not observe"). The ruling was given at head 818e9ed, before the base merge changed the footer. Rulings carry no head and no scope. Contributing factor: the driver's own "AC2 accepted" comment. |
| C3 | Counters accumulate across independent base moves | **CONFIRMED** as a spec-level issue (W4 counters never reset; defaults from §4.4). gh-37 ended with `base_conflict_loop: 2` of max 2 (state.json at 0baa029). One more conflicting sibling merge would have sent it to `$stuck`, even though every resolve succeeded on the first try. |
| C4 | Agent commit while parked on an implicit ask is reported as foreign | **CONFIRMED, cause refined.** Gate: `packages/cli/src/runtime/observe.ts:358` (`status !== "running"`). In this instance the commit was single-parent *because* norn had already concluded the merge (H1). The agent's "Merge main into gh-36" (26476f6) is not a merge commit at all. |
| C5 | Head-changed item after `norn update` | **CONFIRMED, wider than reported.** It fires right after **every** ready approval on all three stories, because norn's own `ready.approve → $done` commit moves the PR head past the approved `head_sha`: gh-35 228dac7→858ec56 (A 15:30:31Z), gh-36 b4204f3→3a7c49d (B 15:40:57Z), gh-37 2e4efdc→9a66783 (C 15:29:31Z, *before* any `norn update`). Source: `observe.ts:551-569` (`ready_head_sha`) and `inbox.ts:431`. It is a false positive of F35, hidden from `norn inbox` only by C1. |
| C6 | `max_agents` is a machine cap | **CONFIRMED** as described. It comes from the simulation: three "machines" share `~/.norn`. |
| C7 | MCP permission ask captures no options | **CONFIRMED** (`b-pane-chrome-ask.txt` shows "1. Allow / 2. Deny"; the receipt has no `options`). |
| C8 | Stale "Approve gh-18 ready" with a path that does not exist | **CONFIRMED** (`snaps/01-gh37-human-qa/C/inbox.txt`: path under `norn-sandbox-todoist-c-worktrees/gh-18-…`, which does not exist). |
| C9 | Root `handoff.md` conflicts | **CONFIRMED** (gh-36 `0029-classify` conflicts include `handoff.md`). It comes from the sandbox and skills. Both sides were kept in 26476f6. |

### Missed by the driver

- **H1 (new): park and other non-path commits run `git add -A` and conclude an in-progress merge.** Chain: `implicitAsk` (`packages/core/src/decide.ts:1010`) emits `park` with `commitFor(...)`, which has no `paths`. `act.ts:263` calls `this.commit` without paths. The git adapter's `commit` (`packages/adapters/src/git/index.ts:229-241`) runs `git add -A` and then `git commit` with no `MERGE_HEAD` or unmerged-path check. Result: ac87fb7, a two-parent commit with conflict markers and `Norn-Tick`, pushed to origin. It is the **only commit in main's history with conflict markers**: a `git grep` scan over `git rev-list origin/main` finds exactly this commit. `kill_run` (`act.ts:271`), `stuck` (`decide.ts:619`) and every other path-less commit share the same risk. Had the agent died after the park, `update` would have found `behind == 0` and moved on with markers in `handoff.md`, which `test` would never catch. The "recovered commit" path (`decide.ts:481`, paths = runs dir) would fail outright mid-merge, because git refuses partial commits during a merge.
- **No check of the resolve result.** Nothing verifies that the resolve left no conflict markers, or that the recorded `base_sha` is now an ancestor of HEAD. Nothing records the resolution commit. `update` re-measures `behind` only.
- **No norn output shows `behind`/`conflicts` for a story** outside a stale classification or a `stale:*` item. `norn status` printed gh-37 as "done 3m" while it was 17 behind and conflicting (`snaps/04-after-merge1/C/status.txt`).
- **Per-criterion `evidence` is not checked against the copied evidence directory** (`packages/cli/src/commands/done.ts:60-71`). The probe passed `"evidence":"x.txt"` for a file that does not exist.
- **Flaky suite.** At 078b513 the full `bun test` gave 640 pass / 2 fail. The failures were 5 s timeouts in `human.test.ts` and `criteria.test.ts` (acceptance case 10). Both files pass alone (`audit-evidence/bun-test-078b513.log`). `bun run typecheck` passes.

## 3. Conflict resolutions

| Run | Conflict | Result | Both intents kept? |
|---|---|---|---|
| gh-36 resolve#1 (B, herdr, Sonnet) | base 95f99f4 (gh-35 "projects") vs gh-36 "due today", in `web.ts`, the footer test and `handoff.md` | ac87fb7 (norn, markers) → 26476f6. Footer `open items · ${projects} projects · ${today} due today · v`; due-today test now expects `… projects · 2 due today`; projects test expects `… projects · 0 due today · v`; `handoff.md` keeps both QA blocks | **Yes**: `git diff ac87fb7 26476f6`. Side effect: the template literal's `\n` became a literal newline (same value). The resolve's `python3` edit was approved by `autoyes.sh`, not by a person (`autoyes.log` 17:33:24). |
| gh-37 resolve#1 (C, headless) | f7b93e2 (projects) vs "done" | 31f39e1: `open items · ${done} done · ${projects} projects · v`; the done test is extended to `… 2 done · 2 projects · v`; the projects test's anchor moved from `open items ·` to `done ·` | **Yes**: the diffs against both parents add only the other side's field and test. |
| gh-37 resolve#2 (C, headless) | 0514909 (gh-36 "due today") vs gh-37 | dedf1af (agent, default git message with `# Conflicts:`) + 44ef7b2: `… done · ${projects} projects · ${today} due today · v`; all three tests kept and adjusted | **Yes**. One minor loss: the doc comment kept gh-36's wording ("…and those due today") and does not mention done or projects. Acceptable. The due-today test was loosened from `open items · … · 2 due today` to ` projects · 2 due today · v`. That is still a valid assertion. |
| gh-41 resolve#1 (A, headless) | f298a74 (the person's "open items" → "open" rename plus test fixes) vs "overdue" | 4a4bc9c: `${open} open · ${overdue} overdue · …`; the person's `web.test.ts` fixes are kept (the diff against parent 2 touches only `web.ts` and the footer test) | **Yes**. The review agent also left a note suggesting a symmetric rename. |

All four followed BS5: merge, not rebase; the base sha was named; both intents kept; tests run. None invented new behaviour. The only flaw lies outside the skill: H1.

## 4. Observability scorecard (norn outputs only: `inbox`, `status`, `trace`, `why`, receipts)

| Event | Visible? | Where / gap |
|---|---|---|
| Base move under a story waiting at a gate with a `stale` route | **Yes** | `trace` row "human-qa#N stale — base moved: 17 behind, conflicts: …"; classify receipt; `why`. |
| Base move under a done story (PR open) | **No** | `inbox` lacks the merge item (C1); `status` shows no base facts; only raw tick facts in the trace JSON have them. |
| Base move under a gate without a `stale` route | **Yes** | `stale:*` Check item with `norn update` (BS10). |
| Conflict | **Yes** | `trace` "update#N conflict (base_conflict_loop n/2)" with paths and sha; classify receipt. |
| Resolution | **Partial** | `trace`/`why` show resolve done with handoff prose. No merge sha. H1's marker commit and the agent's fix-up are invisible except as a "foreign commit" line, which is misleading. |
| Stale re-entry from `$done` (`norn update`) | **Partial** | The receipt exists and `why` works, but `norn trace` shows no row for the `update` receipt (gap between ready#1 15:28:31 and update#2 15:35:16 in `trace-gh37.txt`). |
| Unverified criterion | **Yes** | human-qa inbox detail with reason and how (QV7); trace counts per need (QV8). |
| Criterion passed on a ruling | **Partial** | Only because the agent chose to leave a note. Nothing structural marks the verdict as not observed. |
| PR retargeted, or merged elsewhere | **Partial** | Park: yes (Unblock item). Retarget: tick-side only (C1). |
| Head changed after ready | **Noise** | Fires on every story after approval (C5). Hidden only by C1; fixing C1 alone would make it visible noise. |

## 5. Process limits and what they mean

- **Simulated machines.** One Mac, one user, one `~/.norn`, one herdr server, one process table. Separate `heartbeat.json` and holders, so claims (T7) were exercised. Leases, `max_agents` (C6) and `story_not_local` were tested only on a shared host. Cross-host clock or network issues were not tested.
- **The person wrote the criteria into frontmatter.** No `slice` skill ran; the `quick` workflow has none. The QV1 authoring path (the slice skill writing `criteria`) is **untested**.
- **The driver acted as reviewer and approver.** Two of four notes came from the driver. Every AC3 at human-qa was approved without a check, and the gh-41 "AC2 accepted" comment directly caused C2. The gate approvals carry no evidence. Conclusion: QV makes *agents* honest, but a person's approve comment can launder an unobserved criterion into a later `pass`.
- **Direct push to main stood in for a sibling merge (gh-41).** That is fine for git-only BS logic. No PR-merge event was involved, so it says nothing about GR6 or host interplay.
- **Permission prompts answered by a script (`autoyes.sh`).** Seven answers, including the gh-36 resolve's `python3` edit, were never seen by a person. The herdr (B) resolve path was thus "approved" mechanically. On the headless checkouts the allowlist denied the server start, which shaped the QA outcomes.
- **`max_agents` overridden** in `~/.norn/config.yaml`. This is a simulation artefact; it does not affect conclusions about base sync.
- **Custom `quick` workflow.** The shipped `story.yaml` (slices → update → test, with the K6 integrate lock) was **not run**. Update between slices, the K6 lock, and the `ready` gate's `stale` route are untested in the sandbox.
- **Conflicts were trivial.** Every conflict was a single footer line plus one test file, resolved by Sonnet. Resolution quality on semantic conflicts, and the BS5 "abort and `norn stuck`" path, were not exercised.

## 6. Ranked backlog

**HIGH**
1. **H1: never commit through an in-progress merge.** In `git.commit` (`packages/adapters/src/git/index.ts:229`), when `MERGE_HEAD` or a rebase is in progress, or unmerged paths exist, commit only the unit's runs dir, or skip the commit and record that it was owed. Never conclude the merge. Add a marker guard (`git diff --check` / `^<<<<<<< ` scan) to every norn commit. Add a test: resolve parks on an implicit ask mid-merge, no commit lands, the worktree keeps `MERGE_HEAD`, and the agent's later merge commit has two parents and is not foreign. This also fixes most of C4.
2. **C1: keep PR facts across ticks and give them to the view.** Persist the last `story.pr` per story (as `base.json` does for base facts), use it in observe on non-sync ticks, and load it in `loadProjectView`. Without this, BS10 (merge item) and BS11 (retarget) never reach a person, and items flap in notifications.
3. **C2: rulings must not become `pass`.** Change `brief.ts:478` so rulings settle questions of reading and scope and never turn a criterion into `pass`. Scope each ruling to the `head_sha` it was given at. Optionally let QA cite a ruling as verdict `person` with `ruling: <receipt_id>`, which routes `partial` → human-qa as QV5 intends.

**MED**

4. **C3: base counters per base move.** Reset `base_conflict_loop` when `update` reports `done`, or count per base sha. Do the same for `stale_loop`. Otherwise busy sprints park healthy stories. This needs a spec amendment to W4/§4.4.
5. **Verify and record the resolve.** After resolve `done`, check that `base_sha` is an ancestor of HEAD and that no markers remain. Write the merge sha into a classify receipt so `trace`/`why` link to it.
6. **Show base facts.** In `norn status`, show `base: N behind · conflicts …` for each story, and add a `trace` row for `update` receipts from `$done`.
7. **C5: fix the head pin.** Pin the head after norn's own `ready.approve → $done` commit (or ignore trailer-only runs/ commits), and drop the pin when an `update` receipt voids the approval. Fix this together with C1, or C1 turns this noise on.
8. **C4: implicit ask counts as running.** Treat `parked` with `park.kind === "ask"` and a live run as running for Q6 (`observe.ts:358`).

**LOW**

9. C7 (options for MCP prompts), C8 (stale foreign-checkout gate item), C9 (skills: handoff lives under runs/), C6 (name the layer in the queued reason).
10. Doubled `remote:` prefix (`view/src/format.ts:17`, `core/src/handoff.ts:29`).
11. A person's `norn done` in manual mode is recorded as `by: agent, who: claude`.
12. Per-criterion `evidence` not checked to exist (`done.ts:60-71`).
13. Flaky 5 s timeouts in `human.test.ts` and `criteria.test.ts` under the full suite.

**Spec coverage gaps.** The spec has no rule for a person's ruling versus a criterion verdict (C2). It does not ask norn to verify a resolve's result. Counter reset semantics for base loops are unspecified (C3). It does not require base facts in `norn status`.

**Not tested in this run.** The shipped `story.yaml` with slices and the K6 lock (acceptance 1–2 in a slice context); BS3.1 dirty worktree; BS3.3 remote fast-forward and divergence (acceptance 7); BS5 resolve → `stuck` (7a); `base_conflict_loop` exhaustion (3); `stale: behind` (4b); the `ready` gate's `stale` route; `base_branch` other than main (7b second half); host-less (11); BS2 doctor refusing old git; verdicts `person`/`fail` and the `partial` outcome; QV4 `criteria.unchecked_coverage`; the slice skill writing `criteria`; NT2 notes on slices. Unit and replay tests cover several of these; the sandbox did not.

## 7. Bottom line

**`impl-base-sync-qa` is not ready to merge.** The base-sync loop and the verdict gate do what the spec says. All four resolutions kept both intents. Every ready gate was passed at `behind == 0`. But:

1. H1 lets norn itself push a commit with conflict markers that looks legitimate. That is a data-integrity defect in exactly the path this branch adds (resolve under a herdr agent).
2. C1 means two spec items (the BS10 merge-item detail and the BS11 retarget item) never reach a person.
3. C2 lets the brief override the main promise of QV.

Merge after fixing H1, C1 (together with C5) and C2, each with a regression test. Then rerun a short targeted dogfood: a herdr resolve that parks mid-merge, a done story with a conflicting base visible in `norn inbox`, and a rerun after a ruling. C3 and the resolve-verification item should land before team use, not necessarily before merge.
