# norn — rules

Every id'd rule norn follows, and nothing else: how norn works for a person is in [Concepts](../docs/concepts.md), every command and config key in [Reference](../docs/reference.md).

- Cite a rule by its id (S5, W4, R5.1, HC13, …) in a code comment where the code enforces it, and in tests and specs that check it.
- A rule changes only through a story: a `refinement` or `quick` round amends this file directly, keeping every id; a new rule takes a new id. Never add another rules file.
- Section numbers are stable: a removed section leaves a gap, so `§9.3` keeps meaning the same thing.

## 3. Goals

- G1 Every agent run ends in a known, classified outcome.
- G2 All "what next" decisions are made by deterministic code; agents only do one step and report.
- G3 Any story can be continued by a fresh agent or another person from git: with its full record after a claim release or under the `remote` record policy (S11), and from the branch alone, the record lost, otherwise (T5b; gh-195).
- G4 Every action is traceable and explainable; one view shows what needs a human.
- G5 Agent-agnostic and remote-agnostic (GitHub and GitLab).
- G6 Workflows are data (JSON/YAML), editable per repository, validated before use, and applicable to any story or slice.

## 4. Principles

- P1 **Code decides, agents do.** The tick owns transitions; agents report outcomes and never name steps.
- P2 **Pull, don't trust.** The tick observes runner, git and files every time; notifications are never truth.
- P3 **Stateless reconcile.** Facts are re-observed each tick; a killed or restarted heartbeat behaves the same.
- P4 **Facts are separate.** "Turn ended", "pane idle", "step done", "merged" are distinct facts.
- P5 **Bounded everything.** Every retry, nudge and loop has a named counter with a max; exceeding it is a visible `stuck`.
- P6 **Receipts before effects.** Any externally visible action writes its receipt first, so a repeated tick never repeats it.
- P7 **The briefing carries the process, skills carry the craft.**
- P8 **Machine contract is JSON + exit codes**, never prose. Prose (`handoff.md`, spec bodies) is never read by `decide`.

## 5. Glossary

The CLI, docs, schemas and skills use the core nouns defined in [Concepts › Glossary](../docs/concepts.md#glossary). A lint test fails on the **banned synonyms**, not on every word outside the list.

| Don't say | Say |
|---|---|
| `task`, `job`, `ticket` | story / slice |
| `state` (for a workflow node) | step |
| `lease` (for ownership) | claim |
| `result`, `status` (for how a step ended) | outcome |
| `interactive step` | attended step |

Outcomes (`done`, `ask`, `stuck`, `approve`, …) are values, not nouns. An outcome is spelled as the word its reporter types (`approve`, never `approved`).

### 5.1 Identifiers

- ID1 Keys humans type are readable and immutable: story `gh-123` / `gl-45`, slice `gh-123/03`. The slug is frozen at creation and cosmetic only; folders, branches and refs are never renamed and every lookup goes by key.
- ID2 Internal machinery uses ULIDs: `run_id` (also `NORN_RUN`), `tick_id` (trace, `Norn-Tick` trailer), `heartbeat_id` (one per `watch` process, in the claim blob), `receipt_id`, mailbox ref names. Cross-references always use ULIDs. A checkout's machine-local files (`heartbeat.json` among them) live in its machine dir `~/.norn/repos/<id>/`, where `<id>` is the main checkout's folder name, a dash and the first 8 hex characters of the sha256 of the real path of the repository's git common dir: derived, never stored, the same for every worktree of one repository and different for two clones.

## 6. Users, modes and attended steps

- **Solo developer** running stories assigned to them, attended or unattended.
- **Team member** picking up a story a colleague (or their machine) released.

Three separate concepts decide where a human is involved:

| Concept | Where declared | Meaning |
|---|---|---|
| **Attended step** | `attended: true` on an agent step | The agent works *with* a person in the pane (refine, clarify, plan). Always started by a person. |
| **Gate** | `type: gate` step | A person decides (`approve` / `reject` / `answer`); no agent. |
| **Mode** | per story | Who starts **unattended** agent steps: a person (`manual`) or the tick (`auto`). |

**Mode** (repo default in config, stored per story, switchable with `norn story edit <story> --auto|--manual`):

| | manual | auto |
|---|---|---|
| Unattended agent steps | Marked ready; a human opens any agent in the unit worktree (`norn story start <unit>` where the runner opens terminals, MO5), which runs `norn brief` | Tick starts the agent via the runner |
| Attended agent steps | Wait for a human ("Your turn", `norn story start <unit>`) | Wait for a human ("Your turn", `norn story start <unit>`) |
| `check`, `git` steps | Run automatically | Run automatically |
| `gate` steps | Wait for a human | Wait for a human |
| Hooks, receipts, claims, trace | Same | Same |

"Semi-automatic" = auto mode plus gates and attended steps placed in the workflow.

- MO1 *(assumption, revisit)* Mode is stored in the story's `state.json` (run state, S12), changed only by `norn story edit --auto|--manual` (which writes a `mode` receipt) and travels with the story on takeover.
- MO2 *(assumption)* The **effective mode** is computed each tick: `manual` if the step is attended, otherwise the story's mode. A story's mode is, nearest first: the story's own (MO1, `norn story edit --auto|--manual`), its workflow's top-level `mode`, `mode` in `.agents/norn.config.local.yaml`, `mode` in `~/.norn/config.yaml`, built-in `manual` (gh-64 B10). A step never sets `mode` (W5). The runner is detected, never configured: Herdr when running inside Herdr or when `herdr` is on PATH, otherwise headless (gh-64 B29), so auto mode never downgrades for lack of a runner.
- MO3 *(assumption)* A run starts with the first `norn brief` in the worktree (manual) or the launch (auto); it creates the `run_id` and a `started` receipt recording session and PID. The tick never launches an agent for a step that has a live run. Switching auto → manual does not stop a running agent; only the next step waits.
- MO5 `norn story start <unit>` opens an agent on a step a person starts (an attended step, or a ready agent step in effective manual mode). When this machine's runner can open a terminal for a person (the optional `open` capability; Herdr: a focused tab in the unit worktree, in the workspace already on that worktree, else the caller's) it opens one running the start command; otherwise, or with `--print`, it prints that command. It records nothing: the agent's `norn brief` starts the run (MO3). Any other step is refused (`nothing_to_open`); a unit not started yet is refused with `norn tick`.
- MO4 Attended steps relax the unattended machinery: no `silent`, nudges, deadline or `stalled`; the `Stop` hook does not block turn end. Only `died` and an explicit `done` / `stuck` count. The agent reports `done` once the person agrees. An attended run waiting for its person is shown as Your turn after 2 minutes (W2a); this records no outcome (HC1–HC3).

## 7. Repository layout

```
.agents/
  norn.config.yaml              # team config, committed: provider, base_branch, workflow, slice_workflow, record.policy (K2, S11)
  norn.config.local.yaml        # your config for this repo, gitignored: mode, agent, agents (K2)
  norn.config*.schema.json      # JSON schema copies for editors, written by init
  workflows/                    # triage, reproduce, refinement, story, slice, quick (.yaml) — examples copied by init, editable
  specs/<id>-<slug>/            # id is provider-prefixed: gh-123, gl-45
    spec.md                     # frontmatter mirrors remote issue + workflow + spec body
    slices/<nn>-<slug>.md       # frontmatter: id, title, workflow, depends_on, status, labels?
    pr.md                       # story PR body, written by an agent (GR9); prose, never read by decide
    handoffs/<unit>.md          # <unit> = _story or a slice <nn>-<slug>: Goal / Progress / Resume, prose only, committed (S9)
refs/norn/claims/<story-id>     # git ref: claim blob (holder, heartbeat_id, expires_at, last tick_id)
refs/norn/inbox/<story-id>/<ulid> # git ref: receipt from a non-holder (M3)
refs/norn/runs/<story-id>       # git ref: the story's record packed into one commit, with the story branch commit it matches (S12)

~/.norn/
  config.yaml                   # user config: machine keys (max_agents, notify, trace) and your defaults (K2)
  leases/                       # runtime only: agent and port slot leases
  repos/<id>/                   # machine dir, one per checkout (ID2): trace (JSONL per tick, hook events, briefings,
                                #   transcripts), tick and integrate locks, heartbeat.json, caches, runner session logs (sessions/); never committed
    runs/<story-id>/<unit>/     # run state (S12); <unit> = _story or a slice <nn>-<slug>
      [rounds/<NN>-<workflow>/] # story only: one folder per round (RD6), holding the five entries below; a slice holds them directly
      state.json                # commit point: cursor, attempt, counters, workflow_hash, applied_through
      workflow.yaml             # workflow copy pinned when the unit (round) started
      receipts/NNNN-<kind>.json # immutable inputs: done / ask / stuck / answer / approve / reject / unstick / mode / check / started / classify / take
      logs/<run_id>.log         # full check output, kept only on fail
      evidence/<run_id>/        # QA evidence
    superseded/<story-id>-<ulid>/ # a record set aside after another machine took the story over without a release from here (T7a); never pushed
```

The story worktree is on the story branch and holds `.agents/specs/<id>-<slug>/`; it is created at intake, and `spec.md` is never written in the main checkout. Worktrees contain a `.norn-unit` marker and a `.env.norn` (`NORN_SLOT`, `PORT_BASE`, …).

- LY1 The repo config and workflows are ordinary committed files an agent may change inside a step; a running unit keeps its pinned workflow (S7). Nothing machine-local sits in the working tree or in `.git`, so `git clean -fdx` never removes it and no ignore line is needed for it.
- LY2 The code knows one layout. A main checkout whose config, workflows or trace are still in the earlier single folder under `.agents/` is on the old layout: every command but `doctor`, `upgrade` and `help` refuses (exit 3, `do_instead: norn upgrade`), `init` included; with a part in both places every command refuses and names both paths. `doctor` reports the old layout as a failed check. A unit worktree's own files are never classified, so a step that started before the migration goes on.
- LY3 `norn upgrade` (until the next minor also under its old name `norn migrate`, a deprecated alias; gh-61), in the main checkout only and while the tick lock is free, moves the repo to the running norn's version (K8, SK1) and moves the config and workflows to their new places as staged git moves, the trace into the machine dir, and drops norn's old trace line from `.gitignore` (staged). It never commits; the person reviews and commits the move. Each step can run again, so a rerun finishes an interrupted move; on the new layout it says there is nothing to move. After the move is merged, a norn older than the one with `upgrade` cannot read the repository.

### 7.1 State ownership

| Layer | Written by | Committed | Purpose |
|---|---|---|---|
| Frontmatter (story/slice) | humans, `norn-refine`/`norn-slice` skills; CLI changes only coarse `status`, `workflow` (via `norn story edit --workflow`) and mirrored remote fields | yes | intent |
| Run state in the machine dir (`runs/<story>/<unit>/`: JSON, `workflow.yaml`, logs, evidence) | CLI only | no; pushed to `refs/norn/runs/<story>` as S11 says | machine state |
| `handoffs/<unit>.md` | agents and humans write Goal / Progress / Resume; the CLI only creates it and removes an old generated block once (S9) | yes | context for the next agent or person |
| Claim, mailbox and run-state refs | CLI only | pushed refs | atomic ownership, remote receipts, the record off the machine |
| trace, in the machine dir `~/.norn/repos/<id>/` | CLI only | no | debugging, `run view --why`, `retro` |
| `~/.norn/leases/` | CLI only | no | machine-wide caps and slots |

### 7.2 Run state

- S1 All JSON writes are atomic (temp file + fsync + rename) and validated against `@norn/schema` on every read.
- S2 A file failing validation marks its unit `corrupt`; the tick never guesses and never starts over.
- S3 Each unit (the story or one slice) writes only its own run-state folder (S12), so parallel slices never conflict.
- S4 Commits made by norn carry trailers `Norn-Story`, `Norn-Slice` (a slice's commits), `Norn-Step` (once the unit has a cursor), `Norn-Tick`. A commit that ends a step, on an outcome edge that moves the cursor to another step, also carries the boundary trailers `Norn-Outcome` (that outcome) and `Norn-Next` (the step it moved to); a person moving the cursor (`moved`), an edge back into the same step and an edge to `$stuck` carry neither (gh-195 D17). A story unit's boundary commit is made even when nothing else changed (`allow_empty`), so its branch always holds its last boundary; a slice's is not *(awaiting the person's confirmation at the ready gate, gh-195 D17)*.
- S5 **`state.json` is the truth** and the commit point: it is written last. It holds the cursor, attempt, counters, `workflow_hash` and `applied_through` (the last applied receipt number). Counters exist only there, never in memory.
- S6 **Receipts are inputs.** `receipts/NNNN-<kind>.json` are immutable and written first. Each carries `receipt_id`, `run_id`, `step` and `attempt`; a step-only mailbox receipt (T9) arrives without `attempt` and is kept with the attempt it matched. Each tick applies every receipt numbered above `applied_through`, then rewrites `state.json`; a crash between the two re-applies idempotently on the next tick.
- S7 **Workflows are pinned per unit, and per round on a story.** At unit start (a story: round start, RD2) the workflow is copied to the unit's (round's) `workflow.yaml`. Editing the repo workflow affects new units and rounds only. Within an unfinished round, `norn story edit <unit> --at <step>` moves the cursor to a step of the pinned workflow (journaled); a slice adopts another workflow only through `norn story edit <unit> --workflow <name> --at <step>` (journaled); a story changes workflow by starting a round (RD2–RD4). If the cursor's step no longer exists, the unit goes `stuck`.
- S8 **Commit and push at step boundaries only**: when a receipt lands or a step is classified. The commit contains the agent's work and its `handoffs/<unit>.md`, never run state (gh-195). The claim holder then pushes the unit's branch (story or slice), and then the run-state ref when S11 says so. Per-tick details stay in the trace, in the machine dir.
- S9 **`handoff.md` is context, never state.** Each unit's `handoffs/<unit>.md` holds only Goal / Progress / Resume, written by agents and people, and is never parsed back. The status it used to carry (story, slice, step, attempt, counters, last outcome, next command) is rendered from `state.json` by `brief` and `story checkout`, above the handoff's text. A generated header or heartbeat block left from an older norn is removed at the unit's next boundary commit (gh-195).
- S10 *(retired by gh-195)* Run state is no longer in a PR diff, so nothing is collapsed: `norn init` adds no `runs/**` line to `.gitattributes`, and `norn upgrade` stages the removal of one left from an older norn.
- S11 **Record policy.** The team config picks `local` (default) or `remote`, read at every boundary, never pinned per story. Under both, the holder pushes the story's record to `refs/norn/runs/<story>` before any claim release (T6), each time `open-pr` runs, before it opens or updates the PR (so the PR body can link evidence by the ref's commit, GR9), and once at the end (GR6, GR6b). Under `remote` it is pushed at every step boundary as well, right after the branch. A failed push of the ref at a boundary is retried at the next tick; the step goes on.
- S12 **Run state lives in the machine dir** (`~/.norn/repos/<id>/runs/<story>/<unit>/`, ID2), never in a worktree or in git, so removing a worktree or `git clean -fdx` leaves it alone (LY1). S1–S7 hold for it unchanged. `refs/norn/runs/<story>` holds one commit with the story's whole record (every unit, every round) and the story branch commit it matches, absent for a story without a branch. Only the claim holder pushes it; a normal clone does not fetch it, and norn fetches it only when a command needs that story's record.

## 8. Heartbeat

Launch crashes, orphans and heartbeat liveness are in [R5](#r5-launch-crash-orphans-and-heartbeat-liveness) (§13.1).

- H1 `norn tick` is one idempotent pass: **observe → decide → act → log**, under a local lock. A person command that needs that lock and finds a live tick holding it waits for it, up to 60 seconds, saying so on stderr, then runs; still held after that, it refuses (`tick_locked`). `norn tick` and `norn migrate` refuse at once.
- H2 **Observe** collects facts: frontmatter, run state (S12) and unapplied receipts, git refs (local and remote, incl. mailbox), worktree status, runner pane state, hook events, process liveness (PID + start time).
- H3 **Decide** is a pure function `(facts, pinned workflows, config) → actions`, at most one action per unit per tick. It records which rule fired.
- H4 **Act** performs actions, writing receipts first (P6); every action and its result is appended to the trace.
- H5 `norn watch --interval 30s` runs ticks in a loop; cron/launchd may be used instead, with `norn tick --interval <d>` naming the interval it is run at (default 30s). Each tick records its interval in `heartbeat.json`; liveness checks (H10) and claim timing (T4) use the recorded interval (gh-64 B34). There is no interval key. Remote calls (sync, claim beats, mailbox fetch) are throttled and never block local reads.
- H6 Performance: `tick`, `brief`, `status`, `story list` complete in < 1 s on local state.
- H7 Claim renewal is a **side action** (R1): decide emits it beside a story's one unit action; act renews first and, when the renewal's CAS is lost, skips the story's other actions this tick (`skipped: claim lost`), so merge cleanup and receipt application never starve.
- H8 Act failures are never `ok: true` (R4.3): an action whose effect failed (send, resume, launch, push, answer delivery) reports `ok: false`; the unit's last failure is kept machine-local, shown in `status` and as an Unblock item until an effect of the same kind succeeds.
- H9 Every tick writes `tick.start` before act and `tick.end` after (R5.4); `norn run view --why` shows a tick with no end as "tick crashed during act".
- H10 `heartbeat.json` records `last_tick_at` (R5.5). Older than 3 × the recorded interval (H5) while a held story has auto work → Unblock item "no heartbeat on <holder> for 7m — run `norn watch`", and auto steps lose their manual start hint.
- H11 Every call that reaches a remote (`git fetch`/`push`/`ls-remote`/`pull`/`clone`, every `gh` and `glab` call) has a timeout (2 min). On timeout its whole process group is killed (git and the `ssh` it started) and the call fails as a retryable network error, so a connection dropped while the machine slept never holds the tick lock (H1). Local git calls have no timeout: a commit runs hooks.

## 9. Agent integration

Prompts the agent is blocked on are in [R6](#r6-prompts-the-agent-is-blocked-on) (§13.1).

### 9.1 Hooks

- A1 `norn init` appends norn hooks into each configured agent tool's repo config (e.g. `.claude/settings.json`), marked as norn-owned; re-running updates them in place; `norn uninstall` removes them.
- A2 Hooks call `"${NORN_BIN:-norn}" hook <event>` (R8.1) and report lifecycle facts: turn start/end, tool use, waiting for input (incl. permission prompts), session end, transcript path. Each fact is appended to the unit's own hook file (`hooks/<story>/_story.jsonl` or `<nn>.jsonl` in the machine dir, the unit of the worktree it fired in, with or without a run id) and to the trace day file. Ticks, `norn hook` and `norn brief` read a unit's hook facts from its hook file only, never from the day files; a tick reads the hook files of units with a live run or an unknown launch (R5.1) and of units whose hook file was written within the hook read window, the longest `stalled` across the loaded workflows (R5.3, W2a). The first tick of a norn with hook files copies each live run's hook lines from the day files into its unit's hook file once, deduplicated by event id, and records it in `hooks/backfill.json` there (`since`, the units `done`; never pruned); runs begun after `since` need no copy.
- A3 Hooks are no-ops outside worktrees containing `.norn-unit`.
- A4 Where the agent supports blocking (e.g. Claude Code `Stop`), ending a turn without a receipt is refused with an instruction to report — in unattended steps only (MO4). The refusals already given to a run are counted from its unit's hook file (A2).
- A5 Agents without hooks are a lower tier: runner, process and git facts only.
- A6 When launching, norn sets `NORN_HOME`, `NORN_STORY`, `NORN_SLICE`, `NORN_RUN` and `NORN_BIN`. The launched command itself starts with `env PATH=<shim dir>:… NORN_BIN=<shim>`, where the shim `~/.norn/bin/norn` execs the launching norn, so `command -v norn` in a runner pane resolves to it even after a login shell resets `PATH` (R8.1).
- A7 `norn doctor` (M4) runs a test turn per adapter and verifies hooks fire; it runs `command -v norn` in one throwaway runner session and fails when it resolves to another norn (R8.2), and warns when `NORN_MACHINE` overrides the machine name (R7.3). Its repo group checks the layout (LY2), validates every repo workflow as a tick would (W5) and the repo config against its schema, naming the file and each issue; `doctor --repo` runs only that group, needs no agent, runner or remote, and changes nothing, so CI can run it. Without `--repo` it also checks the remote's labels (GR10): a missing label, an unused `norn:wf:*` label or a remote it cannot reach is a warning naming the fix (`norn upgrade`, the delete command, `gh auth login`), never a failed check.

### 9.2 Sessions and briefing

- B1 Each step gets a **fresh agent session**; context passes between steps only via files (handoff, receipts, diff).
- B2 Within a step, nudges, answers and resumes go into the **same session** (pane input / `--resume`) while counters allow; if the session is gone, a fresh session for the same step starts from the handoff.
- B3 `norn brief [--json]` renders the briefing from data only:

| Section | Source |
|---|---|
| Where you are (story, slice, step, attempt, effective mode, attended) | `state.json` |
| Your work (skill, optional instructions) | pinned workflow step |
| Inputs (spec, slice file, diff range) | step `inputs` + frontmatter |
| Rework (when entered from a failure) | latest failing `check` receipt + log, or findings from the `review`/`qa` receipt that sent it back |
| Checks since the last report (step, command, outcome, duration, log; the failing one under Rework left out) | `check` receipts after the unit's last `done` receipt |
| Context (handoff, answer to previous ask) | `handoff.md` + receipts |
| Finish with exactly one of (outcomes + `means`, `ask`, `stuck`) | step `outcomes` + universal reports |
| Limits (deadline, nudges left, port slot) | step limits + slot + config |

- B4 The exact briefing of every run is stored in the trace; briefings are snapshot-testable.
- B5 In auto mode the first prompt is one line: "Use the norn skill, then run `norn brief`."
- B6 Named input kinds `last_check` and `last_findings` may be declared in a step's `inputs`; the Rework section uses them automatically.
- B7 **Launch unknown** (R5.1–R5.3): a `started` receipt without applied state (a crash between the two) is looked for before anything else is decided — hook facts with its `run_id`, runner sessions in the unit worktree, processes with `NORN_RUN=<run_id>`. Found → adopted as the running step; nothing after 2 watch intervals without hook activity → `died`. No run (start, retry, answer or nudge resume) starts beside a run of the same step with hook activity in the stalled window.
- B8 **Launch prompt not received** (R9.1): a run with `SessionStart` but no turn start for 60 s gets its launch prompt typed again, once (not counted); 60 s later it is `silent` with rule "launch prompt not received" and the inbox names the pane.
- B9 **Prompts the agent is blocked on** (R6): an implicit ask is resolved without a person when a later fact shows the agent moved on — its pane leaves `waiting_input`, a newer hook for the run arrives, or the agent reports — by an `answer` receipt `by: "agent"`. Agent reports are accepted while parked on an implicit ask; an explicit `norn ask` still refuses them. `norn story answer` to a pane prompt types the keys it expects (the option number + Enter, arrows + Enter for unnumbered menus, else the text + Enter; options parsed by the runner adapter) before writing the receipt; a failed delivery writes no receipt, keeps the unit parked, and the Answer item's command becomes how to reach the pane.

### 9.3 Reporting verbs

| Verb | Meaning |
|---|---|
| `norn done <outcome> --handoff "…" [--findings <file>] [--evidence <dir>] [--criteria <file>] [--note "…" [--note-criterion <id>]]…` | Step finished with a declared outcome. The only way a step completes. Findings, evidence, the criteria report (QV2) and notes (NT1) are stored with the receipt. Refusals: `invalid_criteria`, `outcome_contradicts_verdicts`, `criteria_required` (§10.1). |
| `norn ask "<question>" [--option …]` | Needs a human answer to continue. |
| `norn stuck "<reason>"` | Cannot continue. |

All CLI output is JSON with exit codes; refusals return `{"error", "do_instead"}`.

## 10. Outcomes and classification

Three sources of outcomes:

1. **Step outcomes** — declared per step in the workflow with `means` text, reported by the agent. Workflows are the only place outcomes are declared.
2. **Universal reports** — `ask`, `stuck`, available to every agent step; default route: park → inbox → resume same session.
3. **Classified outcomes** — decided by the tick from facts:

| Step type | Classified outcomes | Rule |
|---|---|---|
| agent (unattended) | `silent` | turn ended / pane idle, no receipt; or the launch prompt was never received (B8) |
| agent | `died` | process gone, no receipt |
| agent (unattended) | `timeout` | step deadline passed |
| agent (unattended) | `stalled` | no hook, git or file activity for the configured window |
| agent | `ask` (implicit) | pane/hook says waiting for input, no receipt (incl. permission prompts — inbox shows the question block, the command's first line and the options; the full screen only with `status --details` and in `run view --why`); unattended only |
| check | `pass` / `fail` | exit code; timeout counts as `fail` with reason `timeout` |
| gate | `approve` / `reject` | human receipt |
| gate (story unit) | `stale` | the unit waits at the gate and the story is stale against its base (BS7); only when the gate declares a `stale` route (BS6) |
| git | `done` / `conflict` | command result (`update`: a dirty worktree or a diverged story branch parks the unit `$stuck` with the reason, BS3) |
| slices | `done` / `stuck` | aggregate of slices; a story it parked `$stuck` is unstuck by norn back into the step once a slice can move again (a person unstuck one, or the slice files changed) |
| any | `exhausted` | a counter reached its max |

- C1 Default routes: `silent` → nudge in same session (counted) → after max, `$stuck`; `died` → retry fresh session (counted) → `$stuck`; `timeout`/`stalled` → same as `silent`. Workflows may override any route. A nudge is typed into the live session when the runner can `send`; else the agent session is resumed with the nudge text (`--resume`, after the old process is terminated) when the runner can `resume`; else the route falls through to a fresh-session retry, counted as a retry (R4.1, R4.2).
- C2 Receipt presence always wins over runner facts. Runner "idle"/"done" alone never completes a step.
- C3 A restart never counts as an answer; a unit parked on `ask` stays parked until a human answers — except an implicit ask, which a later fact may resolve (B9).
- C4 On `silent`, the tick snapshots the last assistant message (from the transcript), commits and diff into the trace and handoff.
- C5 Every `check` run writes a check receipt `{run_id, command, exit_code, duration, output_tail}` (last ~200 lines); on `fail` the full output goes to the unit's `logs/<run_id>.log` in its run state (S12).

### 10.1 Criteria, verdicts and notes

- QV1 Slice frontmatter (and story frontmatter, for story-level QA) may list `criteria: [{ id, verifier: test | agent | person }]` (gh-64 B36 removed `needs`; a slice still carrying it is refused, pointing at `norn upgrade`), written by the `slice` skill next to the prose Acceptance section. Decide never reads the prose (P8).
- QV2 `norn done --criteria <file>` takes a JSON array validated against the `CriteriaReport` schema: one entry per criterion with a verdict — `pass` (`evidence` required), `fail` (`repro` required), `person` (`how` required), `unverified` (`reason` and `how` required: a machine could check it, this session could not). The report is stored in the `done` receipt (`criteria`).
- QV3 An agent step with `criteria: required` refuses `norn done` without a report (`criteria_required`); so does an outcome gated by a `verdict`.
- QV4 With frontmatter `criteria`, the report covers exactly those ids, once each; otherwise `invalid_criteria` (exit 3) with the expected ids in `do_instead`. Without frontmatter `criteria`, coverage is not checked and the trace records `criteria.unchecked_coverage`.
- QV5 An outcome edge may declare `verdict: <v>` (agent steps only, W5). Order `fail` > `unverified` > `person` > `pass`; an outcome with `verdict: v` may be reported only when the worst verdict in the report is `v` — otherwise `outcome_contradicts_verdicts`, and `do_instead` names the outcome that matches.
- QV5a `pass` means observed in this session; an agent that could not observe a criterion reports it `unverified` with `reason` and `how`. Agents declare no capabilities and criteria no `needs` (gh-64 B36), so `norn done` makes no capability check. A person's earlier gate ruling (the brief's Rulings) answers questions but never verifies a criterion on the current code (C2).
- QV6 Default `qa` steps (the story's; the shipped `slice` has none, and the story's `slice` step lists every slice's criteria in `spec.md`'s frontmatter as `<nn>.<id>` so the story's QA covers them, QV4) declare `criteria: required` and `pass` (verdict pass), `fail` (fail, counted), `partial` (person → `human-qa`), `unverified` (unverified → `human-qa`). A workflow may route `unverified` to another agent step instead.
- QV7 A gate's inbox item lists the `person` and `unverified` criteria of the report that led there, with `reason` and `how` (one line in `detail`, one per line in `full` / `status --details`); a rework brief after a rejection repeats the judged report's criteria not passed.
- QV8 Each report is a `criteria` trace event (counts per verdict); `norn run list <unit>` sums them.
- NT1 Every `norn done` accepts `--note "<text>"` (repeatable), each optionally followed by `--note-criterion <id>`; stored in the `done` receipt (`notes`). Notes never block and never change the route.
- NT2 Each open note is a Notes item `note:<receipt_id>:<n>` (`qa note on gh-4/01 (AC3): …`, command `norn run view gh-4/01 --receipt <id>`). Notes are information, not an action: the Notes group sits below Running, does not count as needing a person, and its items refuse approve/reject.
- NT3 Every story-level gate lists the story's open notes in its inbox item. Approving it records them in the `approve` receipt (`acknowledged_notes`), and they leave the inbox; rejecting leaves them open.
- NT4 The `qa` skill uses a note, not `person`, when a criterion passed as written but a person may read it differently.
- NT5 The Notes header says when its notes clear: `cleared by <story> <gate> approval`, naming the nearest story-level gate ahead of the story unit's step (its own when it waits at one), else `cleared when the story is done`. A slice gate's item lists that slice's open notes too; approving a slice gate does not acknowledge them.
- NT6 `norn status` shows Notes as their header line only, with `norn status --notes` beneath; `--notes` lists them. The JSON always carries every note. The cockpit shows them in its preview (CP3).

## 11. Workflows

- W1 Files in `.agents/workflows/*.{yaml,json}`, validated against a published JSON Schema. No lifecycle is hard-coded; `init` copies `triage`, `reproduce`, `refinement`, `story`, `slice` and `quick` as **examples** with no implied mapping beyond the built-in `workflow: triage` and `slice_workflow: slice` (W9). Each does one thing; a story goes through them one after another as rounds (`$done` ends a round, RD1; a person merging the PR ends the story), and a person starts the next round (RD2).
- W2 Step types:

| Type | Purpose |
|---|---|
| `agent` | Run a skill in a fresh session; fields: `skill`, `instructions?`, `inputs`, `agent?`, `model?`, `attended?`, `criteria?: required` (QV3), limits (`deadline`, `nudges`, `retries`; `stalled` is set only in the workflow's `defaults:`), `outcomes`. |
| `check` | Run a shell command in the unit worktree with `.env.norn` loaded and a `timeout`; exit code decides `pass`/`fail`; writes a check receipt (C5). |
| `gate` | Wait for a human `approve`/`reject` (or `answer`). |
| `git` | Built-in actions: `integrate` (slice into story branch: rebase + fast-forward, serialized per story), `push`, `open-pr` (draft story PR into the base branch, BS0; body per GR9, and an open PR gets the new body), `update` (merge the base into the story branch, BS3). |
| `slices` | Story-level bridge: start each slice's workflow when its `depends_on` are done, within caps; `done` when all slices are integrated; picks up slice files added mid-flight. |

- W2a A workflow file may set a top-level `mode: manual | auto` (MO2) and a `defaults:` block with `deadline`, `nudges`, `retries` and `stalled`. A step's own limit wins over `defaults:`, which wins over the built-in 60m / 2 / 1 / 15m. The tick's hook read window covers the longest `stalled` across the loaded workflows. The attended wait (HC2) is fixed at 2 min (gh-64 B25–B28).
- W3 Transitions are keyed on outcomes: `review.changes_requested → implement`. Conditions are expressed only as outcomes (e.g. `refine` reports `done` or `questions`); there is no `when:` guard in v1. An edge is `{ to, counter?, means?, verdict? }`; `verdict` (agent steps only) gates which outcome a criteria report allows (QV5).
- W4 Every **elementary cycle** (a path back to its start visiting no step twice) must include at least one edge with a `counter`. Taking a counted edge increments it; if it would exceed `max`, the edge is not taken and the outcome becomes `exhausted` → `$stuck` with the reason (e.g. "review_loop 3/3 at review.changes_requested"). Counters are per unit and never reset by themselves, except a counter declaring `reset_on: <step>.<outcome>`: taking that edge resets it to 0, journaled with the advance (trace, commit) — e.g. `base_conflict_loop` resets on `update.done`, so only repeated conflicts on one base move count (C3). Otherwise only `norn run rerun --reset <counter>` resets one, journaled. `reset_on` must name a declared edge (W5); it never exempts a cycle from needing a counter.
- W5 Load-time validation: schema; every step can reach `$done`; every elementary cycle has a counter (the validator lists each uncounted cycle with its path); every referenced skill is installed for the agent that runs the step (SK1); no step uses a reserved name; no step sets `mode` (W2a); `verdict` only on outcomes an agent reports (QV5). Invalid workflows are refused before anything runs.
- W6 v1 has no `fork/join`; parallelism comes from independent slices.
- W7 **Reserved targets** start with `$`: `$done` (unit finished; on a story it ends the round, not the story, RD1) and `$stuck` (park in inbox under Unblock with the reason). `$stuck` is always an implicit target of `exhausted`, `stuck` reports and C1 routes. Step names may not start with `$` nor be a reserved word: `done`, `stuck`, `ask`, `exhausted`, `silent`, `died`, `timeout`, `stalled`, `stale`.
- W8 **Workflows are not tied to a level.** Any workflow may run on a story or a slice; constraints are checked at unit start: `slices`, `git: open-pr` and `git: update` only on a story, `git: integrate` only on a slice. A story workflow without `slices` works directly in the story worktree.
- W9 **Workflow selection.** A story's workflow is `workflow:` in `spec.md`, set at intake from a remote label `norn:wf:<name>` if present, else the team config's `workflow` (default `triage`); changeable before start with `norn story edit <story> --workflow <name>`; after start, `--workflow` starts a new round (RD2–RD4). The issue's `norn:wf:<name>` label follows the current round's workflow, for visibility only; a label change never starts or changes a round, and a failed label write warns and does not stop the round (RD5). A slice's workflow is `workflow:` in its frontmatter, proposed by the `slice` skill, editable at the plan gate, default the team config's `slice_workflow` (default `slice`).

### 11.1 Rounds

- RD1 A **round** is one workflow applied to a story, from its start step to `$done`. Each round has its own pinned workflow, cursor, attempt, counters and receipts; counters start at 0 in each round. Rounds share the story branch, worktree, PR, handoff and mode. `$done` ends a round; only GR6 and GR6b end the story. Slices run one workflow each and have no rounds.
- RD2 `norn story edit <story> --workflow <name> [--at <step>]` on a story whose round is finished starts the next round at the workflow's start step, or at `--at`. It works whether or not the finished round left an open PR; a later round's `open-pr` updates that PR (GR9). The same workflow may run again as a new round.
- RD3 On an unfinished round (running, parked or stuck), starting a round is refused unless `--force`, which ends the round (recorded in it as ended by the person, at its step) and starts the next in one journaled change. `--force` is refused while an agent runs a step of the round (`norn run cancel` first) and while any slice of the story is unfinished. On a finished round `--force` is accepted and behaves as without it.
- RD4 `--at <step>` without `--workflow` moves the cursor within the current, unfinished round (S7); on a finished round it is refused, pointing to `--workflow`. Starting a round is refused, as `story edit` is, while another machine holds the claim (T9).
- RD5 The issue's `norn:wf:<name>` label follows the current round (W9); visibility only.
- RD6 The story's record holds one folder per round, `_story/rounds/<NN>-<workflow>/` (NN from 01) in its run state (S12), each with its own state, pinned workflow, receipts (numbered from 0001), logs and evidence; the story's `handoffs/_story.md` stays one file for every round. Slice folders stay `<nn>-<slug>/`, each recording the round that started it.
- RD7 A story whose record is still flat (state directly under `runs/_story/`) is moved into `rounds/01-<workflow>/` by the first tick of a norn with rounds, as one commit on the story branch; it goes on where it was. A flat record already in an archive ref (S12, moved there by `norn upgrade`) is never rewritten; commands that show history read it as round 1.
- RD8 Inbox: a story whose round is finished with no PR is an item for the person, "<story>: <workflow> round done, no PR", with `norn story edit <story> --workflow <name>` or "close the issue"; it shows no recommendation. With an open PR the merge item stays. `status`, `story view` and the handoff header show "Round N · workflow · step"; `run list` marks each round's start and how the previous one ended.

Example (slice):

```yaml
name: slice
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: test, means: "every acceptance criterion (or rework point) has a passing test" } }
  test:
    type: check
    run: bun test
    timeout: 10m
    outcomes: { pass: review, fail: { to: implement, counter: test_loop } }
  review:
    type: agent
    skill: norn-review
    outcomes:
      approve:           { to: integrate, means: "all criteria met, no blocking findings" }
      changes_requested: { to: implement, counter: review_loop, means: "blocking findings in the receipt" }
  integrate:
    type: git
    action: integrate
    outcomes: { done: $done, conflict: { to: merge, counter: conflict_loop } }
  merge:
    type: agent
    skill: norn-merge
    outcomes: { done: integrate }
counters: { test_loop: { max: 5 }, review_loop: { max: 3 }, conflict_loop: { max: 2 } }
```

The shipped workflows (sketches; `sync` and `update` are `git: update`, a conflict goes to a `norn-merge` agent step and back, counted):

- `triage`: `explore (agent, norn-triage: checks the issue still holds, posts a ## Triage issue comment with one recommendation, refinement | quick | reproduce | close, and sets the kind, risk and priority labels, GR11; outcome done) → $done`. The recommendation lives only in the comment, so the inbox item for the finished round stays generic.
- `reproduce`: `reproduce (agent, norn-diagnose: seen as a user, then a red loop and the cause, no fix, posted as a ## Reproduce issue comment; reproduced | cannot_reproduce) → $done`.
- `refinement`: `sync → refine (attended; done → plan, questions → clarify) → clarify (attended) → plan (attended) → $done`. No gate: starting the next round is the person's approval of the plan.
- `story`: `sync → slice (done → approve-slices; replan → $stuck when spec.md has no Plan or the base no longer fits it) → approve-slices (gate) → slices → update → test (check) → qa → describe (writes pr.md, GR9) → open-pr (git) → ci (check: waits for the PR's checks) → ready (gate) → $done`; `human-qa` approve also goes to `describe`; `human-qa` and `ready` route `stale` back to `update` (counted, `stale_loop`), workflow fields `base: { stale: conflict, step: update }` (BS6–BS9). Rework found by story `test`/`qa`/`ci` goes to `implement` in the story worktree, counted. After `$done` the round is finished; the story waits for the observed PR merge (GR6) — a fact, not a gate — or for a person to start another round (RD2).
- `slice`: as in the example above; no QA of its own.
- `quick`: `sync → implement → update → test → review → describe → open-pr → ci → ready → $done`, in the story worktree (no `slices`, W8).

The chains a person runs: a feature `triage → refinement → story`; a small change `triage → quick`, or `triage → refinement → quick` when it needs a spec first; a bug `reproduce → quick`, or `reproduce → refinement → quick` when the fix needs a design.

## 12. Remote and git

- GR1 `norn sync` (also run by `tick`, throttled ~5 min) uses `gh`/`glab` to list issues assigned to the user with the label `norn` (fixed, gh-64 B30); the sync runs about every 5 min and is not configurable. Assigning is how the person chooses when an issue is taken in: an open labelled issue not assigned to them is their backlog, which the cockpit lists (CP2). `norn story take <story>` assigns such an issue to them (the cockpit's take on it), so the next sync takes it in; it refuses a closed issue, one without the label, and one taken in already.
- GR2 Intake: create the story branch and story worktree, write `.agents/specs/<id>-<slug>/spec.md` there mirroring provider, number, URL, title, assignee, body and `workflow` (W9); start the story workflow. A spec folder an older norn wrote holds `story.md` instead: norn reads and writes that file while the folder has no `spec.md`, and never renames it.
- GR3 Story branch `<id>-<slug>`; slice branches `<id>/<nn>-<slug>` cut from the story branch, each in its own worktree.
- GR4 Only the CLI rebases, integrates and pushes. Pushes happen at every step boundary (S8), so every step boundary is a handoff point.
- GR5 A person merges the story PR.
- GR6 **PR merged** → story `done`: push the final record to `refs/norn/runs/<story>` (S11), then remove story and slice worktrees, delete slice branches (local and remote) and the local story branch, delete claim and mailbox refs. The spec folder with its handoffs stays in the base branch; the record stays on the run-state ref, kept until a person deletes it (`tidy` never does), and the base branch never receives it. `run list`, `run view` and `norn-retro` read a finished story from that ref.
- GR6c `norn upgrade` (LY3) moves run state that an older norn left in the base branch's tree: per story it packs the record into `refs/norn/runs/<story>`, pushes it, and only then stages the removal of that story's run state from the tree; a story whose push fails keeps its run state and is named with the reason. A rerun pushes only the refs still missing. An open story's run state on its branch is moved into the machine dir by the holder's first tick, removed from the branch in one commit and, under `remote`, pushed to the ref; it goes on where it was.
- GR6b **Issue closed, no PR, no unfinished round** (the last round at `$done`, no slice unfinished) → norn finishes the story as `norn story close` does: pushes the story branch and the final record to its run-state ref (S11), removes worktrees, local branches, claim and mailbox refs, and marks `spec.md` closed, so `norn story reopen` brings it back, unpacking its record from the ref, once the issue is reopened.
- GR7 **PR closed unmerged, issue closed (with an unfinished round, else GR6b), unassigned or unlabelled** → the story parks with reason `remote: <what>` under Unblock. norn never deletes work on its own; `norn story close <story>` cleans up (pushing branches first, as `story handoff` does); `norn run rerun` resumes.
- GR7a `norn story reset <story>` takes a story back to before intake: it removes its worktrees, its local and remote story and slice branches (the record goes with them), leases, mailbox refs (T9) and the claim, after asking (`--yes` skips the question). The remote issue is left alone, so the next sync takes it in again from the current base while it is assigned and labelled (GR1, GR2). Without `--force` it refuses a story holding work a reset would delete: an open or merged PR, a started slice, or commits since intake or uncommitted changes outside the story's spec folder. A claim another machine holds is refused as `story close` refuses it. Remote branches go first; a failed deletion stops it with everything on this machine in place.
- GR6a (BS11) **Merged means merged into the base.** GR6 cleanup fires only when the PR's base branch (`story.pr.base_branch`) is the story's base branch (BS0), or the story head is already on the fetched base (P2). A PR merged into any other branch parks the story with reason `remote: PR merged into <branch>, not <base>` (GR7); an open PR targeting another branch is a Check item (retarget).
- GR8 **Issue edited** → mirrored frontmatter fields (title, assignee, URL) update; the spec body is never overwritten. If the remote body changes after `refine` finished, an inbox item "issue body changed since refine" appears; it does not block running slices.
- GR9 **PR body.** An agent step (the template's `describe`, skill `norn-pr`) writes the body to `<spec_dir>/pr.md`: a summary picture, before/after evidence from QA, merge danger. `open-pr` reads the file as opaque text in act — decide only names it (P8) — first pushes the story's record (S11), rewrites each link to a path inside the record (`evidence/<unit>/<run_id>/<file>`) to that record commit's file URL on the remote, and puts the issue link (`Closes <url>`) under it; with no file the body is the link alone. When the story's PR is already open, `open-pr` replaces its body instead of opening another, so after rework the PR describes the branch as it is now. A body edited by hand on the remote is overwritten: edit `pr.md`, or reject at `ready` with what to change.
- GR10 **norn creates the labels it uses (gh-67).** The labels norn uses are the intake label `norn` (GR1), one `norn:wf:<name>` per workflow in `.agents/workflows/` that validates (W1, W5, W9; slice and repo-local ones included) and the fixed triage set (GR11). `norn init` and `norn upgrade` (on every run, even with nothing else to move) list the remote's labels and create each missing one, with the norn colour `#5319E7` and a description (the workflow's `description`; a fixed sentence for the others). They never edit or delete a label: an existing one is left as it is, and a `norn:wf:*` label naming no workflow is reported as unused with its delete command. A workflow that fails validation gets no label and is named. Their report (and `--json`) lists the labels created, already there, unused and not created, each not created with its reason and the `gh`/`glab label create` command. No remote, a missing or logged-out CLI, no permission or a failed call never fails them or changes their exit code: the report says labels were not checked or not created, why, and what to run. Only `init` and `upgrade` create labels; a tick never does, so a missing label still makes RD5's swap warn. `doctor` checks the same labels (A7).
- GR11 **Triage labels (gh-67).** The fixed set, not configurable: `norn:kind:bug|feature|security|chore|docs`, `norn:risk:low|medium|high` (how much the change could break: blast radius, one-way vs two-way door), `norn:priority:low|medium|high|extreme`. The `triage` step's agent (skill `norn-triage`) judges one of each, gives the reason for each in its `## Triage` comment (`**Kind:**`, `**Risk:**`, `**Priority:**`) and adds the label with `gh`/`glab` when the issue carries none from that set; a label already there (a person's or an earlier triage's) is kept and the comment says what triage would pick instead. It never creates, edits or deletes a label definition and never removes a label from the issue; a label it cannot set is named in the comment (pointing at `norn upgrade`) and the step still ends `done`. decide never reads these labels; they are for people filtering the backlog.

### 12.1 Base sync

- BS0 The **base branch** is the team config's `base_branch` when set, otherwise the remote's default branch as discovered — never assumed to be `main`. The **git remote** is derived: the remote the base branch tracks, else `origin` (gh-64 B31). A story's **base ref** is `refs/remotes/<git_remote>/<base>` when the git remote exists, else `refs/heads/<base>`. Intake cuts story branches from it; `open-pr` targets it.
- BS1 Observe adds per story `story.base {ref, sha, head, merge_base, behind, ahead, conflicts}`. `conflicts` comes from `git merge-tree --write-tree --name-only --no-messages <story head> <base sha>`, computed only when the pair (story head, base sha) changed since the last measurement (cache `base.json` in the machine dir); the facts are in the trace, so `norn run view --why` replays them.
- BS2 `norn doctor` requires git ≥ 2.38 (`merge-tree --write-tree`); `norn watch` refuses to start a heartbeat otherwise.
- BS3 `git: update` (story units only, W8), in the story worktree: a dirty worktree → `$stuck` (`worktree dirty`); takes the story's integrate lock (K6); adopts the remote story branch when it is a fast-forward of the local one (a person pressed "Update branch"), `$stuck` (`story branch diverged from <remote>`) when they diverged; `behind == 0` → `done`, no commit; else `git merge --no-ff <base sha>` with message `Update <story> from <base> (<short sha>)` and the `Norn-Tick` trailer (Q6), pushed at the step boundary (S8, T7) → `done`; a conflicting merge is aborted → `conflict`, with the base sha and the conflicting paths in the classify receipt (`base`).
- BS4 **Merge, never rebase** the story branch: it is published (draft PR, T5), slice branches are cut from it (GR3) and the ready gate pins its head (F35). GR4 is unchanged.
- BS5 The `resolve` step runs the `merge` skill on the base: its brief's Rework carries the base sha, the conflicting paths and "merge `<sha>` into the story branch in this worktree, resolve, commit the merge; never rebase". Conflicts are resolved by intent (both sides' commits, this story's spec and criteria, the base change); a resolution needing new behaviour aborts the merge and reports `norn stuck "<why>"`. On `done` the workflow returns to `update`. The agent's merge commit is never a foreign commit: commits made during a run of the unit — from its first to its last receipt, open-ended while it runs or is parked on an ask — are the agent's (Q6, C4).
- BS6 Classified outcome `stale` at a story gate (§10), only through a declared `stale` route; otherwise only the BS10 inbox item.
- BS7 A story is **stale** when `base.conflicts` is non-empty (default), or with workflow field `base: { stale: behind }` when `base.behind > 0`.
- BS8 Taking a `stale` route writes a `classify` receipt `{outcome: stale, rule: "base moved", detail: "<n> behind, conflicts: …", base}`; the edge back carries a counter (W4; default `stale_loop: { max: 10 }` — a stale re-entry is progress from outside, bounded by the sibling merges). The default `base_conflict_loop: { max: 2, reset_on: update.done }` counts conflicts per base move, not per story (C3).
- BS9 `norn story update-branch <story>` re-enters the step named by workflow field `base.step` (default: the first `git: update` step) when the story unit is done with an unmerged PR, parked at a gate, stuck, or held at an agent step by drifted bundled skills (gh-61 B22; the receipt then names them, `skills_drift`), and only while this checkout holds the claim (T7; never through the mailbox); refused otherwise with `do_instead`. It writes a receipt `update {from, to, reason: "person"}` before the state change (P6, S5). Re-entering from `$done` passes the ready gate again (F35): `ready_head_sha` comes only from an `approve` receipt newer than the unit's last re-entry (`update`, `workflow`), so the old approval raises no "head changed" item (C5). The tick never moves a done unit by itself.
- BS10 Inbox: a Check item per stale story (BS7) waiting at a gate without a `stale` route or stuck — `gh-3 conflicts with main in a.ts, b.ts (4 behind)`, command `norn story update-branch gh-3`, id `stale:<story>:<base sha>`; the "Merge PR #N" item shows `behind <base> by N` and, when conflicting, its command is `norn story update-branch <story>`. PRs are fetched only on sync ticks, so each checkout keeps the last PR it saw per story with its observation time (`pr.json` in the machine dir, `story.pr_seen`); the PR items (merge, retarget GR6a, head changed F35) use it on the ticks between syncs and in `norn status`/`status`, and stay put instead of flickering. Decide acts only on a freshly fetched `pr` (C1).
- BS3.3a **A person's push to the story branch is taken in, never lost**. A person may push to the story branch at any time (a `$done` story included) while norn keeps committing locally. When a push of the story branch is rejected because the remote moved, and when `update` finds the branches diverged, norn fetches `<remote>/<branch>` and fast-forwards to it if it can, else merges it (`git merge --no-ff`, message `Merge <remote>/<branch> into <branch>`, norn's trailers incl. `Norn-Tick`), then pushes. A conflicting merge is aborted: the push stays a failed effect (Unblock item naming the paths) and `update` goes `$stuck`. Never rebase (BS4). The person's commit still moves the head the ready gate let through (F35 item).
- BS5.1 **A deferred commit never takes the unit's turn**. Observe reports the operation in progress per worktree (`worktree.in_progress`). While one is, the owed recovery commit is not decided at all (act could only defer it): the unit's other rules run as usual — an implicit ask on a second prompt mid-merge, `died`, `silent`, `stalled`, `timeout`. The commit follows once the merge is concluded.
- BS5.2 **Nothing with conflict markers is published**. Before any push of a story or slice branch, norn looks at the files changed by the commits not yet on any `<remote>` ref (merge commits against their first parent). If one still holds both an opening `<<<<<<< ` and a closing `>>>>>>> ` marker line (with the label; a lone `=======` is a setext heading) at the head being pushed, the push is held: a failed `push` effect (`ok: false`, Unblock item) naming each file and the newest outgoing commit that changed it. A follow-up commit that removes the markers releases it; norn never rewrites the branch.
- BS10.1: the `stale:*` item appears only where `norn story update-branch` is the next thing to do — the story unit parked at a gate without a `stale` route, or stuck in a step other than an `update` step and the step its `conflict` routes to (resolve). Never for an ask (a permission prompt parks the unit in any step), nor while the story is in update or resolve.
- BS10.2: the F35 head-changed item compares the ready approval's head only with a PR fetched this tick or one seen after the approval; a PR remembered from before the approval is not compared.
- BS11 **Merged means merged into the base.** GR6 cleanup fires only when the PR's base branch equals the story's base branch (BS0). A PR merged into any other branch parks the story with reason `remote: PR merged into <branch>, not <base>` (GR7) — the lesson from the earlier norn, where a merge into the wrong base skipped story review. Retargeting a PR is reported as a Check item.

## 13. Claims and team handoff

- T1 Claims are per **story**: one heartbeat drives a whole story; slices are scheduled locally by it.
- T2 Claim ref `refs/norn/claims/<story-id>` holds a blob: holder (`user@machine`), `heartbeat_id`, `expires_at`, last `tick_id`.
- T3 Acquire and renew via compare-and-swap: `git push --force-with-lease=<ref>:<expected>`. Losing the race fails with "held by X since Y".
- T4 **Beat lease**: each live tick renews. The lease is the larger of 10 min and 4 × the recorded tick interval (H5), renewed every third of the lease; neither is configurable (gh-64 B35). Each claim carries its own `expires_at`. Liveness is the beat, never the claim age.
- T5 `norn story checkout <story>` succeeds after expiry, pulls the story and slice branches, fetches `refs/norn/runs/<story>`, unpacks the record into its machine dir and resumes from it and the handoffs. Before expiry it requires `--force`. Every take, forced or not, writes a `take` trace event and a `take` receipt `{previous_holder, previous_heartbeat_id, expired, record_lost}` (R10.1) on the story unit before any other effect; `run list` and `run view --why` show it (R10).
- T5a When the record's branch commit is an ancestor of the story branch head, checkout continues as recorded. When it is not (the branch was rewritten), checkout keeps the record (counters, rounds, history) and restarts the current step as a new attempt, saying why in its output and in the brief's "Why this attempt".
- T5b With no run-state ref, checkout starts a new round of the workflow in the story's frontmatter, pinned fresh from the branch, at the step the last boundary commit led to (its `Norn-Next` trailer, S4; for a boundary an older norn made, its `Norn-Step`) when that workflow has it, else at the workflow's first step, with attempt 1 and fresh counters. The `take` receipt says `record_lost`; checkout prints that the record was on the old holder's machine and is lost; the brief tells the agent to find on the branch what is already done. A machine whose own machine dir was wiped recovers a story it held the same way, with `--force`.
- T6 **Parked is not released.** A story parked on `ask`, `stuck` or a gate keeps its claim and the heartbeat keeps renewing it. The claim is released only by `norn story handoff <story>` (pushes branches and the run-state ref first, then deletes the claim), a clean `watch` exit, `norn story close`, or lease expiry. Every release but expiry pushes the record first (S11).
- T6a `story handoff` (incl. a `watch` exit) pushes a story branch and the run-state ref only while this heartbeat holds the claim and the branch push is a fast-forward; when either push fails it deletes nothing and says why (R3.3).
- T7 Only the claim holder pushes the story and slice branches, and writes receipts for the story (R2.2). The tick that applies a receipt commits and pushes in the same tick; `started` receipts are committed in the launch tick (R2.1).
- T7a A checkout that finds another heartbeat holding a story it has run state for, taken over without a release from this checkout (claim expiry or `--force`), sets that record aside as superseded in its machine dir (`superseded/<story>-<ulid>/`), never pushed and never merged into the new holder's, and shows one Check item "your record of gh-9 was superseded when X took it over (last local receipt 0035-done)". A copy this checkout released cleanly (`norn story handoff`, a clean `watch` exit or `story close`, which pushed the record first, T6) is already on the ref: it is removed quietly, with no Check item. Which one it is, is told from durable facts, never timing: a copy whose tree is a record commit this machine pushed to the story's ref (`Norn-Holder`) counts as released. `norn tidy` deletes a superseded record older than `trace.retain` (R2.3; gh-195 replaced `orphaned/`).
- T7b An intake that loses the claim CAS removes what it created on this checkout when it holds no further commits, else keeps it and raises T7a (R3.1). Decide never acquires a story whose spec on the base ref says `done` or whose PR merged — the base's spec wins over any local spec (R3.2). A story's spec is read only from its own worktree (`.norn-unit`) or the base ref, its run state only from the machine dir or its run-state ref (R3.4, S12).
- T7c Runs record `machine` (`user@host`) and `heartbeat_id` in their `started` receipts (R7.1). Process and pane liveness are checked only for runs of this machine; a run from another machine is judged by its hooks and the claim — after a `story checkout`, no hook activity in the stalled window → `died` with rule `foreign run, holder changed` (R7.2). `NORN_MACHINE` overrides the machine name, as a test aid (R7.3).
- T7d A checkout that does not hold a story shows its step, attempt and counters only from the run-state ref (S12), labelled "record as of <time>" when the story's policy is now `local`. With no ref it shows the claim (holder, heartbeat, expiry), the branch's last commit, the last boundary's step from its `Norn-Step` trailer (else "no boundary pushed yet"), the PR and its CI, and that the run state is on the holder's machine with the way to get it (`norn story handoff <story>` there, or a takeover after expiry).
- T8 `story approve`, `story answer`, `run rerun` acquire the claim for the local heartbeat when it is free.
- T9 **Mailbox (M3).** A non-holder's `story approve` / `story answer` / `run rerun` is pushed as a blob to `refs/norn/inbox/<story-id>/<ulid>`. The holder's tick fetches mailbox refs during sync, copies each into the unit's `receipts/` in its run state as the next numbered receipt, writes state, pushes the run-state ref when S11 says so, and deletes the mailbox ref. The sender stamps `step`/`attempt` from the run-state ref when there is one, else only the step the last boundary commit led to (its `Norn-Next` trailer, S4) with no attempt, which the holder matches by step alone, and says the check happens on the holder. A receipt whose `step`/`attempt` no longer matches is rejected into the trace and shown as a Check item on the holder ("answer from X for gh-9 was rejected: gh-9 is at <step> now"), which clears once a later answer or approval for that story is accepted, or the story finishes. Before M3 the CLI refuses with `do_instead`.
- T10 Stories are never picked up automatically except at intake; unclaimed stories show in `status`/`story list` as "Unclaimed — `norn story checkout <story>`".

### 13.1 Recovery: claim loss, nudges, prompts, launches

#### R1 Claim renewal is not a unit action

- R1.1 `claim.renew` no longer occupies the unit's single action per tick. Decide emits it as a **side action** of the story, alongside at most one unit action.
- R1.2 Act performs a story's renewal **before** that story's other actions. If the renewal's CAS fails (the claim is gone or held by another heartbeat), act skips every other action of that story in this tick, records them as `skipped: claim lost`, and the next tick sees the claim as `other`/`expired`.
- R1.3 Consequence to test: on a tick where renewal is due and the PR is merged, the same tick decides `cleanup_merged_story`; on a tick where renewal is due and a `done` receipt is waiting, the same tick applies it.

#### R2 Receipts reach the record promptly, and lost ones are reported

- R2.1 The tick that applies a receipt (writes `state.json`) commits and pushes in the same tick (S8). `started` receipts are committed in the launch tick (no `recover.commit` on the next tick, N6).
- R2.2 A checkout that does not hold a story's claim never pushes that story's branches and never writes new receipts for it.
- R2.3 Observe reports, per story held by another heartbeat, a local record this checkout still has (gh-195 replaced `unpushed_runs`); the tick removes it quietly when this checkout released it cleanly, else sets it aside as superseded (T7a), so receipt numbers are never reused or pushed. Inbox Check item `superseded:<story>:<ulid>`, one per superseded copy: "your record of gh-9 was superseded when X took it over (last local receipt 0035-done)".

#### R3 Intake race and stale records

- R3.1 When `claim.acquire.intake` loses the CAS, act removes what the intake created on this checkout (story worktree, local story branch, local spec folder) if it holds no commits beyond the intake commit; otherwise it keeps them and raises the R2.3 item.
- R3.2 Decide never emits `claim.acquire` (intake or re-acquire) for a story whose spec frontmatter on the base ref says `status: done` or whose PR is merged. The base's spec wins over any local spec.
- R3.3 `story handoff` (including on `watch` exit and `story close`) pushes a story branch and the run-state ref only if this heartbeat holds the claim and the branch push is a fast-forward of the remote branch; otherwise, or when the ref push fails, it deletes nothing and reports why.
- R3.4 The snapshot reads a story's spec only from that story's own worktree (identified by its `.norn-unit` marker) or from the base ref, and its run state only from the machine dir (S12) or, for a finished story, its run-state ref. A worktree never supplies another story's spec (N1).

#### R4 Nudges that can be delivered

- R4.1 Runner ports declare capabilities: `send` (can type into a live session) and `resume` (can continue a finished session by id). Headless: `send: false, resume: true`. Herdr: `send: true, resume: true`.
- R4.2 A nudge (C1 routes for `silent`, `stalled`, `timeout`) is delivered by `send` when available; otherwise by `resume` with the step's nudge text (same path the B2 answer already uses: `--resume <agent_session_id>`), after terminating the old process if it is still present. Without either capability the route falls through to a fresh-session retry (counted as a retry, not a nudge).
- R4.3 **Act failures are never `ok: true`.** Any action whose effect failed (send, resume, launch, push) yields `ok: false` with the reason; the unit's failure is visible in `status` and as an inbox item under Unblock: "nudge to gh-10 not delivered: <reason>". This also covers A4's hidden failure.
- R4.4 `status` shows the last classification of a run (`stalled since 10:02`), not only process liveness, so a frozen agent is never shown as plain `alive`.

#### R5 Launch crash, orphans and heartbeat liveness

- R5.1 A `started` receipt whose run has no applied state (crash between receipt and `state.json`) puts the run in **launch unknown**. Before deciding anything else for that unit, the tick looks for the run: hook facts with its `run_id`, runner sessions whose label or `checkout_path` match the unit worktree, processes with `NORN_RUN=<run_id>` in their environment where the OS allows it.
- R5.2 Found → **adopt**: record the session in state and continue as a normal running step. Not found after a grace window of 2 watch intervals with no hook activity for that `run_id` → classify `died` (C1, counted).
- R5.3 The tick never starts a new run for a step while any run of that step has hook activity within the stalled window — answers and retries included (A14b).
- R5.4 Every tick writes a `tick.start` trace record before act and a `tick.end` after. `norn run view --why` shows a tick with no end as "tick crashed during act" and still resolves receipts that cite it (N2).
- R5.5 `heartbeat.json` records `last_tick_at`. `status` and `story list` show it per checkout; if it is older than 3 × watch interval while any unit of a story this checkout holds is in auto mode, inbox adds Unblock item "no heartbeat on <holder> for 7m — run `norn watch`" and `status` stops showing manual start hints for auto steps (N3, A8).

#### R6 Prompts the agent is blocked on

- R6.1 An **implicit** ask is resolved without a person when a later fact shows the agent moved on: the pane left `waiting_input`, a newer hook event for the run arrived, or the agent reported (`done`, `ask`, `stuck`). The resolution writes an `answer` receipt with `by: "agent"`. Agent reports are accepted while parked on an implicit ask (A14); they stay refused while parked on an explicit `norn ask`.
- R6.2 `norn story answer` to an implicit ask is delivered as keystrokes the prompt expects: for choice prompts the option number plus Enter (options parsed by the runner adapter from the pane, exposed as the ask's `options`); otherwise the text plus Enter.
- R6.3 Delivery failure (R4.3) leaves the unit parked and replaces the inbox item's command with how to reach the pane (`herdr` attach command), and the answer receipt is not written.

#### R7 Liveness across machines

- R7.1 `started` receipts record `machine` (`user@host`) and `heartbeat_id`.
- R7.2 Process liveness (`died`) is checked only for runs started on this machine. A run from another machine is judged by its hooks and by the claim: after a `story checkout`, a foreign run with no hook activity in the stalled window is classified `died` with rule `foreign run, holder changed`.
- R7.3 For tests and single-host dogfood, `NORN_MACHINE` overrides the machine name (documented as a test aid; `doctor` warns when set).

#### R8 Agents in runner panes run the right norn

- R8.1 In every runner-started agent, `command -v norn` resolves to the norn that launched it. Act puts a shim directory (`$NORN_HOME/bin/norn` → the current norn entry point) first on `PATH` **inside the launched command itself**, so a login shell in the pane cannot reset it, and exports `NORN_BIN` with the absolute path. The command runs the agent through a launcher file (`$NORN_HOME/launch/<hash>.sh`) that sets both and execs it, so the typed command stays short whatever `PATH` is (B2: a pane truncates a line over the tty limit). Hooks installed by `init`/plugin use `NORN_BIN` when set.
- R8.2 `norn doctor` runs `command -v norn` through the detected runner (one throwaway session) and fails when it resolves elsewhere.

#### R9 Launch prompt not received

- R9.1 A run with a `SessionStart` hook but no turn start within 60 s gets its launch prompt re-sent once (`send`). If still nothing after another 60 s, the run is classified `silent` with rule `launch prompt not received` and the inbox says so with the pane to look at.

#### R10 Takeovers are in the record

- R10.1 Every `norn story checkout`, forced or not, writes a `take` trace event and a receipt kind `take` `{previous_holder, previous_heartbeat_id, expired: boolean, record_lost: boolean}` on the story unit before any other effect. `norn run list` and `norn run view --why` show it.

## 14. Concurrency and resources

- K1 `max_agents` (default 9, 1–9: one per slot) caps agent sessions **per machine**, across all repositories and stories; check commands share the same cap, with no key of their own (gh-64 B18, B53). Extra ready steps queue: oldest story (by intake time) first, then slice number.
- K2 Configuration lives in three files, each with its own schema, every key optional (gh-64):
  - `~/.norn/config.yaml` (user): machine keys `max_agents`, `notify`, `trace.retain`; personal keys `mode`, `agent`, `agents.<name>` (`model`, `args`).
  - `.agents/norn.config.local.yaml` (local, gitignored by `norn init`): `mode`, `agent`, `agents.<name>`; overrides the user file for this repo.
  - `.agents/norn.config.yaml` (repo, committed): `provider` (detected from the remote URL; refused when unset and the URL names neither GitHub nor GitLab), `base_branch`, `workflow`, `slice_workflow`, `norn_version` (K8).

  A key in the wrong file is refused with `config_wrong_file`, naming the file that takes it; a moved or removed key with `config_moved`, naming its replacement and `norn upgrade`, which rewrites the files (user in place, repo staged) and moves team limits and mode into the workflows. Maps merge key by key, lists and scalars replace: an `agents` entry merges field by field over the built-in one, `notify` (`{os, ntfy: <url>, webhook: <url>}`, `os` on by default, Herdr on by itself inside Herdr) merges over the built-in map. `agent` and `agents` take only the built-in agents. Config errors are `config_invalid`, `config_wrong_file` or `config_moved` under a "Config error" title with their own exit code, never S2 `corrupt`. Everything without a key is built in or derived (MO2, H5, T4, GR1, BS0, K4, W2a).
- K2a `norn config list` (`norn config get <key>` for one) prints the resolved configuration: each setting, with a key or without, with its value and its source (`built-in`, `derived` with the reason, `user`, `local`, `repo`). Read only.
- K3 Agent and port slots are lease files in `~/.norn/leases/`, created atomically (`O_EXCL`) with repo, unit, `run_id`, PID and start time. Dead holders are reclaimed by PID + start-time check. Leases are not committed; another machine allocates its own.
- K4 Each worktree gets a slot (`NORN_SLOT`, `PORT_BASE`) in `.env.norn`. Slots are fixed at 1–9 with 10 ports each, slot `n` starting at `4000 + 10·n`; there are no slot keys (gh-64 B33).
- K4.1 Before a check runs, every process listening on the worktree's slot ports (`PORT_BASE` … `PORT_BASE + 9`) whose working directory is inside that worktree is stopped (SIGTERM, then SIGKILL after 2 s) and named at the top of the check output: a server an agent left running must not fail the check with "address in use". Listeners started elsewhere are left alone; without `lsof` nothing is stopped.
- K5 The tick creates slice worktrees when a slice starts and removes them after integration. `norn tidy [--dry-run]` reports or cleans orphans; each tick reports them.
- K6 Integration into the story branch is serialized per story — slice `integrate` and the story's base `update` (BS3) take the same integrate lock (`integrate-<story>.lock` in the machine dir); a non-clean rebase or merge yields `conflict` and routes via the workflow.
- K7 With Herdr as the runner, `norn tidy` also closes what runs that reported `done` left in Herdr: the run's tab, or only its pane when the tab holds something else, and its workspace when nothing else is left in it. A run counts only when its `started` receipt recorded a Herdr pane on this machine; the pane is found by that id and must still work in the run's worktree, and one whose agent is still working is kept. Runs that ended any other way (ask, stuck, died) are left alone. `--dry-run` lists them; a Herdr that cannot be reached is reported under `kept`, and the rest of tidy still runs. Closing happens only in `tidy`, never after a run on its own.
- K8 **The repo's norn version.** `norn_version` in the repo file is the exact norn version the repo was set up with or last upgraded to; `norn upgrade` writes it, and `norn init` only when the repo has none (gh-61). A binary matches it when it has the same minor (before 1.0; the same major from 1.0) and at least its patch; anything else, older or newer, is a mismatch. The version is read from the main checkout's repo file, so it moves for a checkout when that checkout pulls it.
  - On a mismatch every command that acts (`tick`, `watch`, `sync`, `brief`, the `story` and `run` verbs that change state, `tidy`, `config set|unset`) is refused with a `CliError` and `refused` (P8): `do_instead` names the norn to install, or, for a newer binary, `norn upgrade`. Read-only commands (`help`, `--version`, `doctor`, `status`, `story list|view|wait`, `run list|view`, `config list|get`) run and show the mismatch; `init`, `upgrade` (and `migrate`) and `uninstall` always run; `done`, `ask`, `stuck` and `hook` are never refused, so a session already launched can report. `watch` keeps running, skips each refused tick and notifies once.
  - `norn upgrade` moves the version forward to the binary's own, refreshing the bundled skills and migrating the files that version needs in the same staged diff (SK1, LY3), and never backward: with a binary older than the recorded version it is refused. `norn init` never moves the version or overwrites a drifted bundled skill; on a repo that differs from the binary it points at `norn upgrade`. A repo file without the key is not refused; `doctor` and `status` hint `norn upgrade`.
  - `doctor` (and `doctor --repo`, the CI check) reports the version as a check: a mismatch fails it, a missing key is a warning.

## 15. Human interface and observability

**Commands (v1)**

A noun tree modelled on gh: nouns are things a person can see, verbs are shared across nouns. A verb's target defaults to the unit of the current worktree; at a terminal a missing target prompts with only the units the verb applies to. `norn help` lists the tiers below; `help --all` adds the hidden one.

| Tier | Command | Verbs |
|---|---|---|
| Core | `norn status [--details] [--notes] [--history]` | what needs you, across every story (O1); `norn status --watch [--interval] [--pane]` is the cockpit, `--pane` in a Herdr split below |
| Core | `norn story <verb> [<story\|slice>]` | general: `norn story create`, `norn story take` (GR1), `norn story list`, `norn story view [--web]`; decision: `norn story answer`, `norn story approve`, `norn story reject --reason`, `norn story update-branch` (BS9); work: `norn story start [--print]` (MO5), `norn story chat`, `norn story edit [--auto\|--manual] [--workflow <name> [--at <step>] [--force]] [--at <step>]` (MO1, S7, RD2–RD4); team: `norn story checkout [--force]` (T5), `norn story handoff` (T6), `norn story close` (GR7), `norn story reopen`, `norn story reset [--yes] [--force]` (GR7a) |
| Core | `norn run <verb> [<run\|unit>]` | `norn run list` (O4), `norn run view [--why \| --receipt <id>]` (O5), `norn run attach [--next]`, `norn run rerun [--step <step>] [--reset <counter>]`, `norn run cancel` |
| Setup | `init`, `upgrade` (LY3; `migrate` its deprecated alias), `doctor` (M4), `config list\|get\|set\|unset` (K2a), `uninstall` | |
| Background | `watch`, `sync`, `tidy` | |
| Agent protocol | `brief`, `done`, `ask`, `stuck` | |
| Hidden (`help --all`) | `tick`, `hook`, `status --segment` | |

A removed command name (`drop`, `inbox`, `orient`, …) is an unknown command (usage error, exit 2).

- O1 `norn status` (and the cockpit, `norn status --watch`) groups by action: **Your turn** (attended steps), **Answer**, **Approve**, **Unblock**, **Check**, **Unclaimed**, **Running**, **Notes** (NT2), **Recently done**; each group title carries a few words on what it holds, and each item shows question/reason, age and the exact command to resolve it. A person's start of an agent step (Your turn) shows `norn story start <unit>` when the runner can open a terminal (MO5), with the start command to type by hand in the detail; otherwise the start command itself. A story taken in on this checkout that no tick has started yet is listed too: under Running while the heartbeat is up, else under Your turn with `norn watch`. `norn status --watch` acts on the items through CLI verbs (CP6–CP8).
- O2 `story answer`, `story approve`, `story reject`, `run rerun`, `run cancel` and `story edit` (mode, workflow) write receipts; the next tick applies them and delivers answers into the same session or a fresh one from the handoff. Typing directly into an agent pane is also allowed.
- O3 Notifiers are built in, set by the user config's `notify` map (OS on by default; ntfy and webhook by URL; herdr on by itself inside Herdr, K2), and fire once per new inbox item, receipt-first.
- O4 Trace: one JSONL record per tick with facts snapshot, rule fired, action, result, briefing and transcript pointers. The record keeps its decisions inline and stores the facts snapshot as a skeleton marked `"$chunked": 1`: each story's facts, the machine facts, the remote issues, the replay config and each workflow source are chunks addressed by the sha256 of their JSON, and each run's hook facts are blocks of 64 cut by position, written once. Chunks live once in the day's `<day>.chunks.jsonl` beside the day file, appended and fsynced before the tick line that names them, so no tick line names an unwritten chunk and one day's two files replay every tick of that day. A record without the marker is a full-facts snapshot and is read as before.
- O5 `norn run view <unit> --why` replays the pure decide function on the recorded snapshot and shows the rule that fired; `--receipt <id>` picks the decision that applied that receipt (the command of a note item, NT2). A chunked snapshot is rebuilt byte for byte as observe produced it; a chunk missing from its day makes the record a corrupt trace entry (exit 4, code `trace_corrupt`, naming the hash) and nothing is replayed.
- O6 `handoffs/<unit>.md`: agents write milestones; status and heartbeat lines are never written into it (S9) and live in `brief`, `story checkout` and the trace.
- O7 Trace retention: the trace is machine-local and kept for `trace.retain` (a duration, default `14d`, never less than `14d`, the timelines' window). Only `norn tidy [--retain <duration>]` prunes it, never watch or a tick: it deletes each day file, with its chunks file, dated before today minus the window, and never its `workflows/`; `--dry-run` lists each day with the bytes it would free. A window under `14d` or a value that is not a duration is refused by tidy and a warning in `norn doctor`, never a config load failure. `norn doctor` hints, without failing a check, when the trace holds days beyond the window. `norn run view <unit> --why --tick <id>` for a tick older than the window whose day is gone refuses with `tick_pruned`.

### 15.1 Cockpit and Herdr

#### Attended wait

- HC1 An attended run **waits for its person** when all hold:
  - the unit is `running` an attended agent step, and the run observed is the unit's current run;
  - the run is not dead (process and pane not seen gone);
  - the run's newest hooks, after its last `turn_start` / `tool_use`, are `turn_end`, `waiting_input` or `permission_prompt` — or, with no such hook, its runner pane is `idle`, `done` or `waiting_input` since after the last hook.

  The wait starts at the first of those trailing hooks (or the pane's state change). Claude's `idle_prompt` notification (`turn_end`, ~60 s after `Stop`) therefore does not restart it.
- HC2 After 2 min (fixed, gh-64 B27) of waiting, the inbox shows the unit under **Your turn**: `<step>: the agent is waiting for you`, instead of under Running. Its `since` is the wait start, and its id is `attended:<unit>:<run_id>:<wait start>`, so the notifiers (O3) fire once per wait, and a new turn followed by a new wait is a new item. The delay keeps a live back-and-forth from notifying.
- HC3 The item's command is how to reach the session: the runner's reach command when the run has a runner session, else `cd <worktree>`. Never the start-agent command (a second agent for the step was the dogfood mistake). Every inbox item of a unit with a current run also carries `reach: {worktree, agent_session_id, pane_id}` (nulls when unknown) so front ends can find the agent's pane (HC6).

#### Cockpit commands (replaced)

- HC4 Replaced by the terminal cockpit: CP6 draws it.
- HC5 Replaced: the cockpit acts on rows by key (CP7), not by typed line commands (CP12).
- HC6 The agent pane of a run is found through the runner, never stored: the run's `session.pane_id` when the runner is Herdr; else the Herdr agent whose session id is the run's `agent_session_id`; else the one Herdr agent whose working directory is the unit worktree. Several candidates → none (the cockpit says so instead of guessing).
- HC7 Verbs run in-process through the CLI dispatcher (`runCli`) with the cockpit's cwd and env. Their JSON outcome is shown as one message line: `ok` with the verb's main field, or the `CliError` `error` and `do_instead`. X1 holds: the cockpit reads through `@norn/view` and writes only through CLI verbs.
- HC8 Replaced: without Herdr the cockpit works the same, and the keys that need Herdr say so (CP6–CP9).

#### Herdr plugin

- HC9 norn ships a Herdr plugin at `plugins/herdr/` (id `norn`): an `open` action that opens the cockpit as a split below the focused pane without taking focus (`norn status --watch --pane`); a `pick` action and pane that show it as a popup (`norn status --watch`); a `next` action that focuses the agent pane of the oldest Your turn item with a run (`norn run attach --next`) or shows a toast when there is none.
- HC10 `norn run attach --next` is a one-shot: it builds the view once, takes the oldest Your turn item **with a run** (manual starts are skipped: it never starts an agent), focuses its agent pane (HC6) and prints `{focused: <pane_id>, item: <id>}`. With no such item, or no live pane for it, it refuses `nothing_to_attach` (exit 3) with the item's command, else `norn status`, as `do_instead`. `norn status --watch --pane` opens the cockpit pane.
- HC11 The plugin's commands call `$NORN_BIN` when set, else `norn` from `PATH`, else the launch shim `~/.norn/bin/norn`. The plugin ships in the repo, not in the package or binary, so its README (`plugins/herdr/README.md`) documents `herdr plugin install PruszynskiJakub/norn-next/plugins/herdr` (or `herdr plugin link <checkout>/plugins/herdr` from a checkout), and the actions `norn.open` and `norn.next`. `norn doctor` reports under `runner.cockpit_plugin`, informationally (never failing doctor), whether the plugin is linked when Herdr is the runner; when it is not, `do_instead` is `herdr plugin link` with this checkout's `plugins/herdr` when norn runs from source, else `herdr plugin install`.

#### Pane labels

- HC12 On each redraw, the cockpit labels the agent pane of every item whose run it finds (HC6) with `herdr pane report-metadata <pane> --source norn`: title `<unit> · <step>`, and, for every Herdr status, the item's group as norn sees it — `norn: your turn`, `norn: answer` or `norn: unblock`; a Running item gets the title only. The first item per pane wins (group order). The TTL is 3 × the redraw interval, so labels disappear soon after the cockpit stops. No label is written for a pane norn cannot attribute.
- HC13 Labels are presentation only: they are not facts, decide never reads them, and a failed label write is ignored. Only the cockpit writes them; `tick` stays free of presentation (P2).

#### Herdr notifier

- HC14 Notifier adapter `herdr` shows each new inbox item as `herdr notification show <title> --body <body>`, with sound `request` for Your turn, Answer and Approve and `none` otherwise. It needs `HERDR_ENV=1` or a reachable Herdr socket. Outside Herdr it fails with `unsupported`, and the other notifiers still run. It is on inside Herdr, with no config (gh-64 B20).

#### Workspaces

- HC15 The workspace of a run is found through Herdr, like its pane (HC6), never stored: the workspace holding the run's recorded pane, else the one workspace with a pane (foreground working directory, else the pane's) in the unit worktree. Several candidates → none, and the cockpit says so. `w <n>` focuses it with `herdr workspace focus`; an item without a run (an unclaimed story, a manual start) has no workspace to find, and `w` says so with the item's command. `g` uses it when the run has no agent pane to focus (an approval after the agent ended, a stuck unit), before falling back to the command. Workspace labels are not used: they change with the step and a person may rename them.

#### Notes

- HC16 Replaced: Notes live in the cockpit's preview (CP3), with no accordion and no "new" count (CP12).

#### The model

- CP1 `cockpitModel(view, capabilities)` in `@norn/view` is pure: a `ProjectView` in, a `CockpitModel` out, no IO and no clock beyond `view.at`.
  - `capabilities` says what the front end can do: `{ places: boolean }`. It is true when the front end can focus an agent's pane and open an orient workspace (the terminal inside Herdr).
  - It may also carry `backlog: { me, issues }`: the open issues with the intake label and the person's login, as the front end read them from the remote (`RemotePort.listLabelledIssues`, `whoami`). The model stays pure; without it the backlog holds no issue rows.
  - The model is plain JSON, like `ProjectView`.
- CP2 `CockpitModel` holds:
  - `header`: the repo, how many rows the needs-you section holds (so the count matches what is listed; the inbox's `pending` also counts unclaimed stories, which are story rows here) and the heartbeat (`view.heartbeat`).
  - `rows`, in two sections:
    - **needs you**: one row per inbox item of `your_turn`, `answer`, `approve`, `unblock` and `check`, in O1 order;
    - **stories**: one row per story that has no needs-you row (a story that needs you is listed once, under its item), by tab: `now` (in flight, nearest to done first: fewest steps left in its pinned workflow, `steps_left`), `backlog` (not started), `done` (closed: `story_status` done or dropped, whatever its unit says; newest first, by issue number until the model has a `closed_at`).
    - **issues**: in `backlog`, after its stories, one row per issue in `capabilities.backlog` that is open, not assigned to the person (GR1: assigning is how they choose when intake takes it in) and not taken in already, by number.

    Running, Notes and Recently done items are no rows; the story preview shows them.

  A row has:
  - `id`: the inbox item id, `story:<key>`, or `issue:<key>` (the key the story would get);
  - `kind`: `item`, `story` or `issue`;
  - `tab`: `now`, `backlog` or `done` (an item is always `now`, an issue `backlog`);
  - `group`: for an item;
  - `story`, `unit`, `step`, `title`, `since`, `age`;
  - `preview`: CP3;
  - `actions`: CP4.

  A row's `id` is stable across rebuilds, so a renderer keeps the selection on the same row when the view refreshes.
- CP3 A row's `preview` is the orient report of its story (OR2): standing, slices, PR, what waits, what runs, and the open notes by unit (full text). An item row's preview also has the item's title, detail and command. The preview is data (`OrientReport` plus the item). An issue row has no story yet: its `report` is null and its `issue` holds the number, title, URL, labels and assignees. Each renderer lays it out itself.
- CP4 Each action of a row is data:
  - `id`, `label`, `key`: the default key, a single letter or `enter`;
  - `input?`: `{ prompt, required }`, when the action needs text from the person;
  - `effect`, one of:
    - `{ kind: "verb", argv, show? }`: a norn command. `argv` may contain the token `{input}`. With `show`, the renderer shows its markdown output.
    - `{ kind: "link", url }`: open a URL.
    - `{ kind: "place", place: "agent" | "orient", reach? }`: go somewhere. Offered only with `capabilities.places`.

  The actions, and which rows offer them:

  | id | key | Row | Effect |
  |---|---|---|---|
  | orient | enter | every row | place orient (inside Herdr: `norn story chat <story>`); without places: verb `story view <story>`, shown |
  | agent | g | an item whose unit has a current run (`reach`) | place agent (HC6, then HC15) |
  | start | s | a Your turn manual start (`norn story start <unit>` in its command, MO5) | verb `story start <unit>` |
  | answer | a | Answer | input "Your answer" → verb `story answer <unit> {input}` |
  | approve | y | Approve | verb `story approve <unit>` |
  | reject | x | Approve | input "What to change" → verb `story reject <unit> --reason {input}` |
  | unstick | u | an item whose command is `norn run rerun …` | verb `run rerun <unit>` |
  | take | t | the story row of a story nobody holds (claim `unclaimed`) | verb `story checkout <story>` |
  | take | t | an issue row | verb `story take <story>`: assigns the issue to the person; the next sync takes it in (GR1) |
  | trace | v | every row | verb `run list <unit>`, shown |
  | pr | o | every row of a story whose PR is known (`StoryView.pr`) | link to the PR URL |
  | issue | i | every row of a story with an issue URL, and every issue row | link to the issue URL |

  The model alone decides which rows offer which action: a renderer never infers it from groups or commands. An action a row does not offer is absent, not disabled.
- CP5 `norn status --watch --json` prints the model once and exits (P8), so a front end outside TypeScript can read it. Running an action needs no extra entry point: its `argv` is a norn command (`norn <argv…> --json`).

#### The terminal cockpit

- CP6 `norn status --watch [--interval 5s]` draws the model full screen: the header, the tab strip, the shown tab's rows on the left (about 60% of the width), the selected row's preview on the right (about 40%; below the rows when the pane is narrower than 100 columns), and a footer. The footer lists the selected row's actions by key, then `1 2 3 tabs · / filter · ? keys · q quit`.
  - The header shows the running norn's version (`norn <version>`, `NORN_VERSION`: a long-running cockpit keeps its binary's version after a new release is installed), the repo and how many rows need you across the repo. While the filter is in use it shows first in the header; there is no filter line.
  - The tabs: `1 Now` (needs you, then in flight; the default), `2 Backlog` (not started, then the issues not taken in), `3 Done` (closed). The backlog's issues are read from the remote when the cockpit starts, at most every 5 minutes after, on `r` and after a take; a failed read keeps the last ones and says so in the footer. The strip carries counts: `1 Now 23 need you · 8 in flight │ 2 Backlog 2 │ 3 Done 35`.
  - Each section header carries its count (`NEEDS YOU 23`, `IN FLIGHT 8`, `BACKLOG 2`, `ISSUES 4`, `DONE 35`).
  - A needs-you row shows its mark, unit, step, the story's title and its age; the item's instruction stays in the preview. A story row shows its unit, title and standing (`<status> <step>`; a closed story reads `done`), then its slices and PR only when it has them. An issue row shows its key, title, labels and assignees (`unassigned` when none).
  - It reads raw keys (a terminal in raw mode), draws on the alternate screen (frames leave no scrollback) and turns on mouse reporting for the wheel; all of it is restored on exit, SIGINT and SIGTERM included.
  - It redraws on every key and every interval, with a fresh view on the interval and after each action.
  - Frames go to stderr, one JSON summary (the last action taken) to stdout at exit (P8).
  - It ends on `q`, Esc with no filter and no prompt open, end of input, SIGINT or SIGTERM.
- CP7 Keys:
  - ↑↓ or `k`/`j` move; PgUp/PgDn move a page.
  - ⌃d / ⌃u scroll the preview by half a screen, within what it holds; moving to another row scrolls back to its top. The footer offers them when the preview does not fit.
  - The mouse wheel (SGR mouse reporting) scrolls the preview by 3 lines when the pointer is over it, and moves the selection when it is over the list. Other mouse buttons do nothing.
  - `1` `2` `3` show a tab. Each tab keeps its own selection and filter.
  - `]` / `[` go to the first row of the next / previous section; `n` goes to the next row of the same kind (the same inbox group, e.g. the next approve; for a story, the same section and standing), round to the top.
  - `/` opens the filter: typing narrows the shown tab's rows to those where every word appears; Enter keeps the filter, Esc clears it.
  - An action's key runs it on the selected row. A key the row does not offer shows `no <action> here`; nothing runs.
  - An action with `input` opens a one-line prompt in the footer, labelled with its `prompt`. Enter submits; Esc cancels. Empty text is refused when `required`.
  - `r` refreshes, `?` lists every key, `q` quits.
- CP8 Every action leaves the cockpit open. Its outcome is one line in the footer: `ok: norn story approve gh-1`, or the `CliError` `error` and `do_instead` (HC7), or where a place action went. A shown verb's markdown replaces the preview until the selection moves or Esc is pressed.
  - Effects run as follows: `verb` through the CLI dispatcher in-process (HC7); `link` with the platform opener (`open` on macOS, `xdg-open` on Linux); `place` through the Herdr cockpit adapter.
- CP9 Inside Herdr the cockpit also labels agent panes, as before (HC12, HC13).

#### Names, plugin and what goes away

- CP10 `norn status --watch` is the only cockpit command; `norn pane` and `norn pick` are removed, with no aliases (pre-1.0, a minor version may change the machine contract). What `norn pane` also did moves:
  - `norn run attach --next` focuses the agent pane of the oldest Your turn item with a run, as `norn pane --next` did (HC10).
  - `norn status --watch --pane` opens the cockpit in a Herdr split below the caller, as `norn pane --open` did.
  - The plain redrawn inbox (`norn pane` without flags, O1 "a Herdr status pane") is dropped: `norn status` prints it and the cockpit replaces the pane.
- CP11 The Herdr plugin keeps its ids, and every entry runs the cockpit:
  - `norn.open` shows it as a split below the focused pane (`norn status --watch --pane`);
  - `norn.pick` and pane `pick` show it as a popup over it;
  - `norn.next` runs `norn run attach --next`.
- CP13 The cockpit opens on any workspace. When its directory is in no repository, or in one norn was never set up in (no norn config), it shows the repository the last `norn status --watch` ran in on this machine. That path is kept in `<norn home>/cockpit.json` (`last_repo`), written by every `norn status --watch`; it is presentation state, never a fact. With no such repository it refuses as any command outside a repository does.
- CP12 Removed:
  - the `norn pane` and `norn pick` commands (CP10);
  - the line commands (HC5's table) and their parser (`parseCockpitLine`, `planCockpit`);
  - `pickKey`'s own action rules;
  - the Notes accordion and its per-checkout `trace/cockpit.json` marker (HC16): notes live in the preview (CP3), with no "new" count.

#### Orient

- OR1 `norn story view <story|unit> [--json]` is read only: no receipt, run or claim. It prints markdown by default and `--json` gives the report (P8).
- OR2 The report (`orientReport` in `@norn/view`) holds:
  - the story's title, issue URL, standing, mode and claim;
  - each slice's standing and last outcome;
  - the worktree, branch and spec path;
  - the PR as last seen, and the `gh pr view <branch>` / `glab mr view <branch>` command (`config.provider`);
  - the inbox items of the story that wait for the person, with their commands, and those running;
  - the open notes, grouped by unit, the unit with the newest note first;
  - where to look: the spec, `norn run list`, `norn run view --why`, `norn status`.

  The markdown opens with rules for an agent: a summary of at most 5 lines that counts the notes, then answers; norn commands that change anything only when the person says so; no code edits, commits or outcomes; notes grouped by topic when asked.
- OR3 `norn story chat`, inside Herdr:
  - It focuses the workspace labelled `<story> orient` that has a pane in the story's root (or no panes).
  - Otherwise it creates that workspace in `StoryView.root` and runs the default agent there, with its configured args, prompt "Run `norn story view <key>` and follow it."
  - The agent runs with `NORN_ORIENT=1` and its own shim `~/.norn/orient/bin/norn`, first on PATH (R8.1).
  - Outside Herdr, it prints the command.
- OR4 With `NORN_ORIENT=1`, `norn hook` records nothing and `brief`, `done`, `ask` and `stuck` refuse with code `orient_session`. An orient session is no run.

#### Tab bar segment

- SG1 `norn status --segment [--ttl 30s]` prints one plain line: `norn·<repo>` and, per group that has items, a mark, count and word (`▶ 1 your turn ◆ 1 answer ● 1 approve ✖ 1 stuck ◇ 1 check ◐ 2 running`), or `✓ nothing waits` (with the running count). Herdr runs it (`tab_bar_right`) in the focused pane's directory. Outside a repository it prints an empty line and exits 0.
- SG2 With Herdr reachable (`HERDR_ENV=1` or `HERDR_SOCKET_PATH`):
  - It writes a `norn` token on each orient workspace of the repo, with the TTL: the first waiting group with `+n` for more, else `◐ running`, `✓ done` or `· quiet`.
  - It moves those workspaces, within the slots they hold, so the ones that need the person come first. Other workspaces never move. It makes no move when the order already holds.

  Herdr's `insert_index` is a gap in the order with the workspace still in it.
- SG3 Tokens and order are presentation only (HC13). Failures are ignored. The segment is the one command that writes them (AGENTS.md "Decisions").

## 16. Skills

Single-purpose skills ported from ai-engine (the earlier norn): its skill files are the base, edited only where norn's contracts differ (files in the repo instead of issues and comments; no push, no remote writes; verdicts and findings as structured data; the person's say at gates when no person works with the agent). One skill = one kind of step; reference skills hold the craft several step skills share. Outcomes are declared only in workflows; the "Typical outcomes" column is a suggestion for template authors, not a contract. Every name but `norn` carries the `norn-` prefix so the skills stay apart from a project's own.

| Skill | Does | Typical outcomes |
|---|---|---|
| `norn` | One-step protocol: brief, work in scope, keep handoff, report once, end turn, follow refusals. Only skill aware of norn. | — |
| `norn-interview` | One question per turn until shared understanding; only talks. | done |
| `norn-refine` | Story → spec in `spec.md`: Problem, Solution, numbered Behaviour items (`B1`…, each with an example; edges walked as items), Out of scope, Open questions. Owns the spec layout. | done / questions |
| `norn-clarify` | Sort the open questions, settle them with the person, fold each answer into the section it changes. | done |
| `norn-plan` | The `## Plan` section of `spec.md`: seams, coverage table (Behaviour → seam), prefactoring, implementation and testing decisions, risks. Reference: `norn-codebase-design`. | done |
| `norn-slice` | Plan → tracer-bullet slice files (`workflow`, `depends_on`, acceptance citing Behaviour numbers, frontmatter `criteria` with id and verifier (QV1), check commands); expand–contract for wide refactors. | done |
| `norn-implement` | Test-first build of one slice or story at the Plan's agreed seams, then a review pass. On rework, the points from the brief's Rework section come first: each is a red test, a QA failure gives its repro. Reference: `norn-tdd`. | done |
| `norn-review` | Spec and Standards axes kept apart (a subagent per axis when the agent has them); Spec axis traces every Behaviour item and criterion to the test that proves it, in a table written to the handoff (`UNTRACED` blocks unless the verifier is `agent` or `person`, QV1); smells baseline (`SMELLS.md`); findings as structured data. | approve / changes_requested |
| `norn-qa` | Check each acceptance criterion as a user, with evidence (a screenshot for every `browser` criterion); one verdict per criterion in a criteria report (QV2); never pass what wasn't observed (`unverified` when this session cannot check it); notes when a passed criterion may be read differently (NT4); secrets redacted. | pass / fail / partial / unverified |
| `norn-qa-person` | Walk a person through QA from the agent's evidence and their own remarks; a repro for every failure. Shipped for attended QA steps; the templates' `human-qa` is a gate. | pass / fail |
| `norn-pr` | Pull request body from the spec, the diff and QA's criteria reports and evidence: Summary (the smallest picture: pseudocode, call tree, file tree, Mermaid or shape diff), Evidence (before/after per criterion; never claims what was not observed), Merge danger (one-way or two-way door, blast radius). Adapted from mattpocock/skills `pr` (itself after Humanlayer's show-me). | done |
| `norn-diagnose` | Hard bugs, flaky tests, performance regressions: a tight, deterministic loop that goes red on the reported symptom first (no hypothesis before it has gone red), then minimise, ranked falsifiable hypotheses, instrument, bisect; fix behind a regression test at a correct seam, or hand the loop and cause back when told not to fix. HITL loop template (`scripts/hitl-loop.template.sh`); secrets redacted. Runs the `reproduce` template's `reproduce`; `norn-implement` turns to it when a rework failure does not reproduce on the first try. | reproduced / cannot_reproduce |
| `norn-triage` | One issue → a `## Triage` issue comment: still applies on the base (tried, not assumed), repro, affected code (`file:line`), the rules it touches, context, the kind, risk and priority with their reasons (and their labels on the issue, GR11), and exactly one recommendation with its reason; changes no file. Runs the `triage` template's `explore`; the recommendation is in the comment, not the outcome. | done |
| `norn-merge` | Resolve conflicts by intent of both sides; merge the base into a published branch, never rebase; abort and stop if new behaviour is needed. | done |
| `norn-prototype` | Throwaway prototype that settles one design question with a person: a state model as one shareable HTML file (`LOGIC.md`), or radically different UI variants on one route switched by `?variant=` (`UI.md`). Committed on the branch being worked on, in prototype-named files that nothing in the product reaches (real files it edited go back as they were); the spec links its path next to the decision it settled, with the question and the verdict. Not a step: `norn-refine` and `norn-plan` offer it when a decision turns on look and feel or a state model hard to judge on paper, and only suggest it when no person is present. | — |
| `norn-tdd` | Reference: red → green at agreed seams, good tests, mocking at boundaries (`tests.md`, `mocking.md`); refactoring stays out of the loop. | — |
| `norn-codebase-design` | Reference: deep modules, interface, seam, adapter, depth (`DEEPENING.md`, `DESIGN-IT-TWICE.md`). | — |
| `norn-retro` | Retrospective over one finished story, run by a person with an agent after its PR merges, never a step: reads the story's record from its run-state ref (S12) for the story and each slice (counters, receipts, check logs) and the committed handoffs and the local trace in the machine dir if present; ranks the friction (exhausted or high counters, repeated rejects, asks, stuck and lost sessions, `unverified`/`person` verdicts, environment check failures, recurring findings) and proposes one change per finding to a skill, workflow, config, contributor docs or the spec template, citing the receipt. Suggests only: answers in the session and writes or changes no file. | — |

- SK1 `norn init` copies each bundled skill folder that is missing whole into `.agents/skills/`, and `norn upgrade` rewrites every bundled one to the running norn's copy (committed; always the bundled version, the change visible in `git diff`; gh-61: `init` leaves a drifted one alone and points at `upgrade`) and links it from each configured agent's skill folder (`.claude/skills/`, `.gemini/skills/`, `.opencode/skills/`; codex reads `.agents/skills/` itself). A repo customizes a skill by writing its own under another name and naming it in its workflow (W1). `doctor` reports missing, unlinked and drifted skills, and a drifted skill is a failed check (gh-61). A unit whose worktree holds a bundled skill that differs from the running norn's copy starts no agent step: the tick still runs its gates, checks, syncs and merges, the inbox names the fix (bring the base in, or `norn upgrade` in the main checkout), and `story start`, `story chat` and `brief` are refused. A unit worktree whose own repo file records a `norn_version` newer than the running norn (K8) is not compared: its skills belong to the version its branch moves to. Only bundled skills are compared; repo-local skills never are. W5 checks each step's skill against the skills its agent can see.
- SK2 The `norn` skill must stay under ~80 lines; it never contains workflow logic or step names.

## 17. Architecture

- X1 Front ends (web cockpit, Herdr pane, TUI) read only via `@norn/view` and write only via CLI verbs. The project view (`loadProjectView`) carries no timeline and reads no trace day file; a front end that shows timelines asks for them with a separate timeline read (`loadTimelines`, or `loadTraceView` for one unit's step timeline).
- X2 *(deferred, gh-64)* Adapters are built in; config selects no package (no `adapter` or `runner` key). Third-party adapters may return later by implementing interfaces from `@norn/core`.
- X3 Distribution: npm package plus `bun build --compile` single-file binaries. Agent plugins (Claude Code first) are thin wrappers with a `/norn` command; skills come from the repo (SK1), and no logic lives in plugins.
- X4 Core is tested by replaying recorded traces as snapshots (chunked and full-facts records alike, rebuilt by the store's tick read); adapters against recorded fixtures.

