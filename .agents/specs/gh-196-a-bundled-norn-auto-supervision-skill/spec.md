---
id: gh-196
slug: a-bundled-norn-auto-supervision-skill
provider: gh
number: 196
url: https://github.com/PruszynskiJakub/norn-next/issues/196
title: A bundled norn-auto-supervision skill that drives stories from intake to merged PR unattended
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:refinement
workflow: refinement
status: active
intake_at: 2026-11-05T09:19:57.086Z
body_hash: a24d5b1a99594de075c2d340bff0e2a3ccff3f6bf637cc6fcc4a169b852db014
---

# Supervised delivery: norn-fsd and norn-fsd-round

## Problem
A person who wants one or more stories delivered without sitting at the inbox writes a long ad-hoc supervisor prompt for a Claude Code session in the main checkout. Every copy is different and each drifts from norn's protocol in its own way. Eleven supervised deliveries (gh-61 … gh-195, mined in the issue's comment) show what goes wrong:
- supervisors spawned agents to run `norn brief` beside the runner's sessions;
- they typed into step panes, ran `tick` beside a watch, restarted a watch another supervisor relied on (two claims lost), and used `run cancel` and `story edit --workflow` on running units (`$stuck`, corrupt);
- they matched text instead of reading JSON, and polled with timers that expired, missed steps and woke the person for nothing;
- they approved gates and started rounds as if they were the person, so the record cannot tell their decisions from the person's.

The working parts (`story wait` in the foreground, `story answer`, `run rerun --step --reset`, one notification per item that needs the person) had to be rediscovered each time.

## Solution
norn ships two skills that tell an agent in the main checkout how to supervise the stories a person names, using norn's own commands only:

- **`norn-fsd-round`** delivers each named story's current round to its end. It holds the whole supervisor protocol: who does what, what may be decided and what goes to the person, which commands may be used, how to wait and how to report.
- **`norn-fsd`** delivers each named story end to end, across rounds, on top of the same protocol: when a round ends, it judges which workflow comes next and starts it.

The supervisor decides gates and starts rounds on the person's behalf. norn records those decisions as delegated, with the supervisor's reason, apart from the person's own. The person is pinged only for what the protocol reserves for them, and gets one report at the end.

## Behaviour

### Shipping

- B1 As a person setting up norn, I want `norn-fsd` and `norn-fsd-round` installed with the other bundled skills, so that every repo has them without copying a prompt.
  Example: `norn init` in a fresh repo → both skills appear beside `norn-refine` and are linked for each configured agent; `norn doctor` reports them like any bundled skill (missing, unlinked, drifted); `norn upgrade` refreshes them.
- B2 As a person, I want the supervisor skills to be usable by a person-started session only, never as a workflow step, so that no step agent starts supervising.
  Example: a workflow naming `norn-fsd` as a step's skill is not what the skills are for; the skill says it runs in the main checkout, never in a unit worktree, and refuses to start when the working directory is a unit worktree.

### Shape: one supervisor, one subagent per story

- B3 As a person, I want to name the stories to supervise, so that the supervisor never takes work I did not hand it.
  Example: "use norn-fsd-round on gh-201 gh-202" → it supervises exactly those two; a third story waiting at a gate in `norn status` is left alone.
- B4 As a person, I want exactly one supervisor per checkout, so that two of them never fight over the watch or a claim.
  Example: the skill tells the person to run one supervisor per checkout and to add stories to it rather than start another; it never restarts or replaces the watch another session relies on (gh-107, gh-110 lost their claims that way).
- B5 As a person, I want one subagent per story, polling that story in the foreground, so that every story moves and none is forgotten.
  Example: three named stories → three subagents, each looping on `norn story wait <story> --until …` in the foreground; none polls in the background, none runs on a timer that expires.
- B6 As a person, I want only the top-level supervisor to talk to me, so that I get one voice, with the story named in every message.
  Example: two subagents hit escalations at once → the supervisor passes them on one at a time as "gh-201: …", "gh-202: …".
- B7 As a person, I want the supervisor to read norn's JSON, never its text, so that a "done" inside "sync → done" is never taken for a finished story.
  Example: the subagent reads `norn story view gh-201 --json` and `norn run view … --json` and branches on fields; it never runs `norn status <story>` (no such form) and never greps markdown output.

### The watch

- B8 As a person, I want the supervisor to check that a watch is running before it starts, so that auto mode actually moves.
  Example: no heartbeat on the checkout → one escalation "No watch is running. Start it in its own terminal: `! norn watch`" and the supervisor waits for the heartbeat; it does not start one itself.
- B9 As a person, I want a watch that stops while supervising to be reported, never restarted, so that a second watch or a lost claim cannot follow.
  Example: the heartbeat goes stale mid-run → the same escalation as B8, naming the stories that stopped moving; the supervisor never runs `norn watch` or `norn tick` itself.

### Moving the story

- B10 As a person, I want the supervisor to put each supervised story in auto mode, so that the runner starts its unattended steps and every session stays visible in the runner and Herdr.
  Example: gh-201 is manual → the subagent runs `norn story edit gh-201 --auto`; it never runs `norn brief`, `norn story start` or drives a step pane.
- B11 As a person, I want the supervisor to answer asks the spec, the repo or the issue settle, so that a unit does not wait on me for what is already written down.
  Example: an implement agent asks "keep the old flag as an alias?" and the spec's Behaviour says the old flag is removed → `norn story answer gh-201 "Remove it: spec B4 says the flag goes."`; a permission prompt the step plainly needs is answered with its option number.
- B12 As a person, I want an ask nothing settles to come to me, with everything I need to answer it, so that I answer once.
  Example: "gh-202 asks: which config file takes the new key? The spec does not say. Options: repo / local. Recommended: repo (team-wide). Reply and I will answer it." The person's reply in chat becomes `norn story answer` at once, without a second confirmation.
- B13 As a person, I want a stuck unit diagnosed and retried once before it reaches me, so that a passing glitch costs me nothing.
  Example: gh-201 is `$stuck` after a failed launch → the subagent reads the trace and the handoff, finds the launch failure, runs `norn run rerun gh-201`; stuck again at the same step after that → escalated with the reason and what it tried.
- B14 As a person, I want an exhausted loop rerun once past its counter before it reaches me, so that one extra round is tried before I am asked.
  Example: `review_loop` exhausted → `norn run rerun gh-201/02 --step implement --reset review_loop --reason "fsd: …"`; exhausted again → escalated with the findings of each round.
- B15 As a person, I want a hung or cancelled CI run rerun, so that a CI glitch does not send the story back to implement.
  Example: the PR's CI run was cancelled → `gh run rerun --failed <id>` once, then the story's `ci` check is waited on as usual.
- B16 As a person, I want the supervisor to use only the commands the skill allows, so that it never repeats the mistakes the past supervisors made.
  Example: allowed: `story wait`, `story view`, `run view`, `run list`, `status --json`, `story answer`, `story approve`, `story reject`, `story edit --auto|--manual`, `story edit --workflow` on a finished round (`norn-fsd` only), `run rerun [--step] [--reset]`, `gh run rerun --failed`, reading `gh`. Forbidden: `brief`, `story start`, `tick`, `watch`, `run cancel` to serialise work, `story edit --workflow` or `--force` on an unfinished round, `story checkout`, typing into a step pane, editing `runs/` or a unit worktree, running tests in a unit worktree.
- B17 As a person, I want a command the agent's permission classifier refuses handed to me as the exact command, so that it is not retried around.
  Example: `norn story approve gh-201` refused by the classifier → "Run `! norn story approve gh-201 --reason \"…\"`, or allow it with this permission rule: …"; the skill names the permission rule that lets the supervisor approve and answer.

### Gates and delegated decisions

- B18 As a person, I want the supervisor to decide gates itself, through norn commands only, so that a delivery does not wait on me at every gate.
  Example: gh-201 waits at `approve-slices` → the subagent reads the slice files against the spec and runs `norn story approve gh-201 --reason "fsd: 3 slices cover B1–B9, each with criteria"`; a slice that misses a Behaviour item → `norn story reject gh-201 --reason "fsd: B7 is in no slice"`.
- B19 As a person, I want the supervisor to approve `ready` only on green CI for the exact head and a clean diff, so that nothing unchecked reaches the base.
  Example: gh-201 at `ready`, CI green on the head the PR shows, no `runs/` file and no stray `handoff.md` in the PR diff → approved with a reason; CI green on an older head → it waits for the new run; a `runs/` file in the diff → escalated.
- B20 As a person, I want the supervisor to read the PR's state before it acts on a gate, so that it never rejects a PR I already merged.
  Example: I merged gh-201's PR by hand while it waited at `ready` → the subagent sees the merge and waits for the story to end (GR6) instead of approving or rejecting.
- B21 As a person auditing a story, I want every gate decision and round start the supervisor made recorded as delegated, with its reason, so that I can tell its decisions from mine.
  Example: `norn run view gh-201` shows "approve-slices: approve — delegated (supervisor): 3 slices cover B1–B9"; a gate I approved myself shows no such mark.
- B22 As a person, I want delegated decisions shown apart in `norn status` and the story view, so that I can review what the supervisor let through.
  Example: the story view of gh-201 lists "Delegated: approve-slices approved, ready approved (reasons …)"; a story with none shows no such section.
- B23 As a person, I want the supervisor to always give a reason with a delegated decision, so that no delegated decision is unexplained.
  Example: an approve without `--reason` is never sent by the skill; the reason names the evidence (Behaviour items, CI run, merge danger).

### What only the person decides

- B24 As a person, I want a merge, a release, an install or a watch restart only when my request named it, so that nothing irreversible happens on the supervisor's own initiative.
  Example: "deliver gh-201" → it stops after `ready` is approved and waits for my merge (GR6); "deliver gh-201 and merge it" → after `ready` it merges with a squash once CI is green on the final head.
- B25 As a person, I want destructive or shared-state git operations escalated, so that history and claims are never rewritten behind my back.
  Example: a force push, deleting a branch, `norn story checkout` (pushes the claim), or a base conflict from rewritten history or a stale intake (gh-118: 259 commits) → escalated with the exact situation; the supervisor runs none of them.
- B26 As a person, I want a spec question nothing settles, and any change to the rules file, escalated, so that the contract stays mine.
  Example: refine's open question "remove or deprecate the flag?" has no answer in the issue or comments → escalated; a plan that amends the rules file → escalated before the plan is approved.
- B27 As a person, I want a story that is really stuck escalated, so that the supervisor does not loop.
  Example: stuck again at the same step after one diagnosed retry (B13), or a loop exhausted again after one rerun (B14) → escalated with the receipts that show it.
- B28 As a person, I want machine settings left to me, so that the supervisor never changes how my machine runs norn.
  Example: it never edits config, `max_agents` or the watch; when it believes one should change, it escalates with the change and why.
- B29 As a person, I want several questions on one story sent together, and each escalation sent once, so that I answer in one go and am not nagged.
  Example: gh-195's four spec questions arrive as one question set with a recommended option each, with one notification; the same item is not sent again while it waits for me.
- B30 As a person, I want no ping for anything I need not act on, so that the supervisor is quiet while things move.
  Example: steps passing, checks going green, rounds ending → no message; only escalations and the final report.

### Refinement on the person's behalf (norn-fsd)

- B31 As a person using `norn-fsd`, I want refinement run without me, so that a feature goes from issue to PR on its own.
  Example: with unattended refinement (#197) in place, gh-203's refine and plan agents run unattended; the supervisor answers their asks from the issue, the repo and the comments (B11), escalates the rest as one question set (B29), and approves the plan itself unless it hits B26.
- B32 As a person using `norn-fsd` before unattended refinement exists, I want an attended step escalated as my turn, so that it never types into a step pane.
  Example: gh-203 reaches attended `refine` → "gh-203: refine needs you: `norn story start gh-203`"; the supervisor waits for the round to move on.

### Next round (norn-fsd)

- B33 As a person using `norn-fsd`, I want it to judge which workflow comes next when a round ends, so that each story takes the cheapest path that delivers it safely.
  Example: triage recommended `refinement` but the comment shows a one-file docs change with low risk → it starts `quick`; refinement's plan has five seams across three packages → `story`; the same plan with one seam and no new contract → `quick`; `reproduce` confirmed a cause → `quick`.
- B34 As a person, I want the round's choice and its reason recorded as a delegated decision, so that I can see why the story took that path.
  Example: `norn run view gh-203` shows "round 03 quick — delegated (supervisor): plan has one seam, no contract change".
- B35 As a person, I want the next round started only on a finished round, the safe way, so that no running unit is corrupted.
  Example: refinement ends at `$done` → `norn story edit gh-203 --workflow story`, then `--auto`, retried while the new round is not yet there; never `--force`, never on an unfinished round.
- B36 As a person, I want closing the issue and a workflow the skill does not know escalated, so that the supervisor never ends a story or guesses a repo's own workflow.
  Example: triage recommends closing gh-204 → escalated "triage recommends closing gh-204 because …"; a repo-local workflow `hotfix` would fit → escalated with that suggestion.
- B37 As a person using `norn-fsd-round`, I want the supervisor to stop at the end of the current round, so that it never starts another.
  Example: gh-201's `triage` round reaches `$done` → its subagent reports and ends; for `story`/`quick`, the round ends after `ready` is approved (and the merge, when asked for, B24).

### Release

- B38 As a person, I want a `release` story supervised only when my request names it, so that no release happens on the supervisor's initiative.
  Example: "supervise gh-210 (release) and release it" → supervised; a release story not named → left alone. The skills never run `/release-start`.
- B39 As a person, I want `release`'s `ready` always brought to me, with the version, its reason and the changelog section, so that I judge every version.
  Example: gh-210 at `ready` → "gh-210: release 1.4.0 (minor: 3 Added). Changelog: … Approve?"; approved only on my answer.
- B40 As a person who asked to release, install and restart, I want those done in a safe order, so that the old watch does not hit a version mismatch.
  Example: approve → wait for the merge and the publish → install → pull → restart watch and the cockpit; each only because the request named it (B24).

### Load and flakes

- B41 As a person, I want a check that failed on load treated as environment, not a flake, so that a busy machine does not send stories back to implement.
  Example: a check fails with `reason: timeout` while the load is far above the core count → the subagent waits for the load to drop and reruns the step once; it pauses other supervised stories (`--manual`, later `--auto`) when one keeps failing on load; load that stays high → escalated (B28).
- B42 As a person, I want a failure that passes on rerun with no change rerun at its check, not sent to implement, so that no implement round is spent changing nothing.
  Example: gh-201's `test` failed and the unit is back at `implement`, and the same test passes on a rerun with no commit in between → `norn run rerun gh-201 --step test --reason "fsd: suspected flake …"`; the suspected flake goes in the report.
- B43 As a person, I want the supervisor never to run tests in a unit worktree, so that it cannot disturb a step's run.
  Example: to judge a flake it reads the check's receipt (exit code, reason, output tail) and the CI log; it runs nothing in the worktree (gh-118's QA failure).

### Report

- B44 As a person, I want one report covering every supervised story when supervision ends, so that I see the outcome at a glance.
  Example: per story: rounds run (from receipts), findings fixed, delegated decisions with their reasons, escalations and how they were answered, suspected flakes with test and receipt, PR and merge state, and for `release` the version.
- B45 As a person, I want a story that cannot finish still reported, so that the report is never silent about one.
  Example: gh-202 is waiting for my answer when I end supervision → the report lists it as "waiting: your answer to …", with the command to resume.

## Out of scope
- An auto-release workflow that releases without the person — a separate story; `release`'s `ready` stays the person's here.
- Where the flake rule lives in the step (rerun alone, call it a flake only if it passes alone) — #168 covers the check side; the supervisor only avoids wasting a round on one (B42).
- Choosing a model per story or step — #198; the supervisor launches no agent.
- Making refinement unattended — #197; `norn-fsd` only uses it once it exists (B31, B32).
- A cap on how many stories run at once — load is handled by B41, slots by config.
- Supervising stories the person did not name, or several checkouts from one supervisor — one checkout, named stories only.

## Open questions

## Plan

### Seams

- **S1 the cli, through the harness's commands and their `--json` output.** A supervisor's command (`story approve`, `story reject`, `story answer`, `run rerun`, `story edit --workflow`, each with `--delegated --reason`) is run on a harness repo, the next tick applies it, and the record is read back through `norn run view --json`, `norn story view --json` and `norn status --json` (and their markdown). Observes B21, B22, B23, B34 and the code side of B2 (a delegated command refused inside a unit worktree).
  Prior art: the cli integration tests that run a person's command and read the views: `story-decision`, `run-rerun-cancel`, `round-folders` (round start on a finished round), `story-view`, `status`, `records`; the harness's `createHarness` with its fake remote and runner.
- **S2 the bundled skill texts, through the shipped assets and the docs lint.** The asset tests read each shipped `SKILL.md` and check what it states; the command lint checks that every `norn …` command it prints exists with those flags. Observes B1 (shipped with the others) and the protocol items: B2–B20, B24–B33, B35–B45.
  Prior art: the assets unit tests "exactly the skills of §16 are shipped", "the norn skill states the protocol and hard rules", "norn-review traces every Behaviour item…"; the docs lint "commands and flags the docs name exist (B35)". `norn init`, `doctor`, `upgrade` and `uninstall` already work from the shipped folder list, and their existing integration tests cover any skill in it.
- **QA, a supervised delivery (verifier `person`).** The skill items cannot be proven by a test of the text alone: one small story in a throwaway repo, supervised end to end with `norn-fsd` by a real agent, judged by the person against the protocol (no forbidden command run, delegated decisions with reasons, one report). It is acceptance, not a seam: no test is written for it.

### Coverage
| Behaviour | Seam | Test kind (unit / integration / e2e) | Notes |
|---|---|---|---|
| B1 | S2 | unit | shipped list; init/doctor/upgrade generic over it (existing tests) |
| B2 | S1 | integration | `--delegated` refused in a unit worktree; the skill's own refusal is S2 text, checked in QA |
| B3 | S2 | unit | named stories only; QA |
| B4 | S2 | unit | one supervisor per checkout, never replace the watch; QA |
| B5 | S2 | unit | one foreground subagent per story on `story wait`; QA |
| B6 | S2 | unit | only the supervisor speaks, story named; QA |
| B7 | S2 | unit | `--json` reads only, no `norn status <story>` |
| B8 | S2 | unit | heartbeat check from `status --json`, escalation text |
| B9 | S2 | unit | never `watch`/`tick` |
| B10 | S2 | unit | `story edit --auto`, never `brief`/`story start` |
| B11 | S2 | unit | answer from spec/repo/issue with `--delegated --reason` |
| B12 | S2 | unit | escalation shape, reply becomes `story answer` |
| B13 | S2 | unit | one diagnosed rerun, then escalate |
| B14 | S2 | unit | one `--reset` rerun, then escalate |
| B15 | S2 | unit | `gh run rerun --failed` once |
| B16 | S2 | unit | allowed and forbidden lists stated; command lint |
| B17 | S2 | unit | exact command and the permission rule named |
| B18 | S2 | unit | gate checks per gate kind; QA |
| B19 | S2 | unit | `ready` only on green CI for the PR head, clean diff |
| B20 | S2 | unit | PR state read before a gate |
| B21 | S1 | integration | receipt marked delegated; `run view` shows it apart |
| B22 | S1 | integration | story view section; status count |
| B23 | S1 | integration | `--delegated` without `--reason` refused |
| B24 | S2 | unit | merge/release/install/restart only when named |
| B25 | S2 | unit | destructive git escalated |
| B26 | S2 | unit | open spec questions and rules changes escalated |
| B27 | S2 | unit | really stuck escalated with receipts |
| B28 | S2 | unit | machine settings escalated |
| B29 | S2 | unit | one question set, each escalation once |
| B30 | S2 | unit | quiet while moving |
| B31 | S2 | unit | refinement on the person's behalf once #197 exists |
| B32 | S2 | unit | attended step escalated as the person's turn |
| B33 | S2 | unit | round-picking guide in `norn-fsd` |
| B34 | S1 | integration | round start recorded delegated with its reason |
| B35 | S2 | unit | next round only on a finished round, never `--force` |
| B36 | S2 | unit | closing and unknown workflows escalated |
| B37 | S2 | unit | `norn-fsd-round` stops at the round's end |
| B38 | S2 | unit | release only when named; never `/release-start` |
| B39 | S2 | unit | `release`'s `ready` always the person's |
| B40 | S2 | unit | the release, install, restart order |
| B41 | S2 | unit | load treated as environment |
| B42 | S2 | unit | rerun at the check, not implement |
| B43 | S2 | unit | never run tests in a unit worktree |
| B44 | S2 | unit | report fields; QA |
| B45 | S2 | unit | unfinished stories in the report |

### Prefactoring

1. Extend the docs lint's command check to the bundled skill texts — the two new skills print many `norn …` commands (B16, B17, B12, B35); the lint then catches a wrong command or flag in them, and in the skills already shipped. Lands green on its own: any hit in an existing skill is fixed in the same change.

### Implementation decisions

- D1 **Delegated is a flag, `--delegated`, on the person's commands** (agreed with the person). `story approve`, `story reject`, `story answer`, `run rerun` and `story edit --workflow` take it. It beat an environment variable (invisible in each command, leaks into a person's shell) and a new `supervisor` actor (decide and the views branch on `by`, so it would touch decide, the goldens and every reader).
- D2 **The receipt header gains an optional `delegated: true`; `by` stays `human`.** The person's authority is what the supervisor uses, so decide reads these receipts exactly as the person's: no decide change, no golden change. Additive: old receipts validate, old norns ignore nothing they need. It travels in the receipt, so a mailbox delivery (T9) carries it unchanged. The one place receipts for the person are built sets it, so every command above gets it the same way.
- D3 **The reason lives in the receipt's `comment`.** approve, reject and unstick have it already; the `round` and `answer` receipts gain an optional `comment`, and `story edit --workflow` and `story answer` gain `--reason`. `--delegated` without a non-empty `--reason` is a usage error with `reason_required` (B23); without `--delegated` the reason stays optional where it is today.
- D4 **A delegated command is refused inside a unit worktree** (exit `refused`), so a step agent cannot act as a supervisor even if it loaded the skill (B2, SK3).
- D5 **The view collects a story's delegated decisions** across its rounds and slices: step, kind, round, unit, reason, when. `story view` shows them in a "Delegated" section (none → no section); `status` shows a count per story (`delegated` in `--json`, "N delegated" in markdown), never an inbox item (agreed with the person); `run view` and the trace timeline mark each such row "delegated (supervisor)" with its reason, and `--json` carries `delegated: true`.
- D6 **`norn-fsd-round` holds the whole protocol; `norn-fsd` links to it** and adds only the round-picking guide (B33, the cheapest workflow that delivers safely, with the examples of B33) and the round start (B35). The subagent's brief is a template inside `norn-fsd-round`, so every subagent gets the same rules. Both say they run in the main checkout only and stop when `.norn-unit` is in the working directory.
- D7 **The permission rule the skill names (B17)** is the agent's own allow rule for the delegated commands (Claude Code: `Bash(norn story approve:*)` and the like for each allowed command), given as text the person adds; the skill never edits settings itself (B28).
- D8 **Docs and generated files**: the reference block (`docs:emit`) and the JSON schemas (`schema:emit`) are regenerated; the skills table in RULES.md (done in refine) and the user docs that list bundled skills name the two. The repo's `.agents/skills/` copies come from `norn init`/`upgrade`, never hand-edited.

### Testing decisions

A good test here runs the command a supervisor runs, on the harness, and reads the result the person reads (`--json` of the three views): never the receipt file or a view function directly. The skill texts are tested by what they state and by the commands they print being real, never by phrasing beyond the named terms (command names, flags, SK3's escalation classes, the report's fields). What may be faked: the remote, the runner, the notifier and the clock (the harness's fakes); nothing inside norn. The protocol's real behaviour is judged in QA by the person on one supervised delivery.

### Risks

- **The skill is only as good as an agent's reading of it.** Text tests prove it says the right things, not that an agent does them. The QA run is the real check; the slices should ship the skills early enough that the QA delivery can find gaps before review.
- **Adding bundled skills holds running units on drift.** A unit worktree on the old skill set counts as drifted after an upgrade (gh-61 B22): existing behaviour, as when `norn-retro` was added, but worth saying in the PR.
- **The command lint over existing skills may find old mistakes.** The prefactor fixes them; if there are many, they are their own slice.
- **Permission classifiers differ per agent.** D7 names Claude Code's rule; other agents get the exact command to run instead (B17), not a rule.
