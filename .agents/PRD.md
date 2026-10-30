# norn — Product Requirements Document

Status: draft v2 · Date: 2026-10-23 · Owner: Jakub Pruszyński

## 1. Summary

norn is an agent-agnostic CLI that delivers software stories with coding agents (Claude Code, Codex, OpenCode, Gemini, …) under the control of **deterministic code**. A stateless heartbeat (`norn tick`) reads markdown specs, JSON run state, git and the runner, decides the next action with a pure function, and instructs agents one bounded step at a time. Work is defined in JSON/YAML workflows. State lives in the repository and in git refs, so a team on GitHub or GitLab can hand work over at any commit. norn runs in **manual** mode (a human starts agents) or **auto** mode (norn starts agents), and Herdr is its default — optional — cockpit.

norn is built from scratch. ai-engine (norn v0.11.0), limen and cezar are prior art for ideas only (§22).

## 2. Problem

Delivering a story with agents today fails in four ways:

| # | Risk | What happens |
|---|---|---|
| R1 | Agent state is invisible | An agent asks a question in its own pane, dies, or ends its turn — and nothing outside notices. |
| R2 | The unattended loop is unreliable | An LLM running the delivery loop drifts, stalls, wakes on noise and repeats steps. |
| R3 | No "stuck", no handoff | There is no way to say "stuck"; a fresh agent or a colleague starts from scratch. |
| R4 | Losing track | Nobody can tell what is running, what waits for a human, or why the tool did what it did. |

## 3. Goals and non-goals

**Goals**
- G1 Every agent run ends in a known, classified outcome (R1).
- G2 All "what next" decisions are made by deterministic code; agents only do one step and report (R2).
- G3 Any story can be continued by a fresh agent or another person from git alone (R3).
- G4 Every action is traceable and explainable; one view shows what needs a human (R4).
- G5 Agent-agnostic and remote-agnostic (GitHub and GitLab).
- G6 Workflows are data (JSON/YAML), editable per repository, validated before use, and applicable to any story or slice.

**Non-goals (v1)**
- An LLM orchestrator of any kind.
- A server or database; norn is a CLI over files and git.
- Writing status back to GitHub/GitLab beyond pushes (deferred, §20).
- Auto-merging the story PR — a person merges it.
- Permission management for agents (deferred, §20).

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

The CLI, docs, schemas and skills use these nouns. A lint test fails on the **banned synonyms**, not on every word outside the list.

**Core nouns**

| Term | Meaning |
|---|---|
| story | A remote issue (GitHub/GitLab) assigned to the user with the configured label. One spec folder, one story branch, one story worktree, one draft PR. |
| slice | A unit of work inside a story. Own branch and worktree. |
| unit | A story or a slice — anything that runs a workflow and owns a `runs/<unit>/` folder. |
| workflow | A JSON/YAML state machine of steps. |
| step | One node of a workflow. |
| run | One attempt at a step; produces receipts. |
| claim | A git-ref lease giving one heartbeat the right to drive a story. |

**Support nouns**: receipt, outcome, counter, gate, check, handoff, brief, inbox, heartbeat (one pass = tick), mode, worktree, slot, trace, mailbox, verdict, note.

- **verdict** — how one acceptance criterion fared in a criteria report: `pass`, `fail`, `person` or `unverified` (QV2). The worst verdict gates the outcome (QV5).
- **note** — a non-blocking question for a person, left with a `norn done` report (NT1); it reaches the inbox and the story's last gate, and never changes the route.

**Banned synonyms**

| Don't say | Say |
|---|---|
| task, job, ticket | story / slice |
| state (for a workflow node) | step |
| lease (for ownership) | claim |
| result, status (for how a step ended) | outcome |
| interactive step | attended step |

Outcomes (`done`, `ask`, `stuck`, `approve`, …) are values, not nouns. An outcome is spelled as the word its reporter types (`approve`, never `approved`).

### 5.1 Identifiers

- ID1 Keys humans type are readable and immutable: story `gh-123` / `gl-45`, slice `gh-123/03`. The slug is frozen at creation and cosmetic only; folders, branches and refs are never renamed and every lookup goes by key.
- ID2 Internal machinery uses ULIDs: `run_id` (also `NORN_RUN`), `tick_id` (trace, `Norn-Tick` trailer), `heartbeat_id` (one per `watch` process, in the claim blob), `receipt_id`, mailbox ref names. Cross-references always use ULIDs.

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

- MO1 *(assumption, revisit)* Mode is stored in `runs/_story/state.json`, changed only by `norn story edit --auto|--manual` (which writes a `mode` receipt) and travels with the story on takeover.
- MO2 *(assumption)* The **effective mode** is computed each tick: `manual` if the step is attended or this machine has no runner configured, otherwise the story's mode. A downgrade is shown in `status` and `story list` ("auto requested, no runner; running manual").
- MO3 *(assumption)* A run starts with the first `norn brief` in the worktree (manual) or the launch (auto); it creates the `run_id` and a `started` receipt recording session and PID. The tick never launches an agent for a step that has a live run. Switching auto → manual does not stop a running agent; only the next step waits.
- MO5 `norn story start <unit>` opens an agent on a step a person starts (an attended step, or a ready agent step in effective manual mode). When this machine's runner can open a terminal for a person (the optional `open` capability; Herdr: a focused tab in the unit worktree, in the workspace already on that worktree, else the caller's) it opens one running the start command; otherwise, or with `--print`, it prints that command. It records nothing: the agent's `norn brief` starts the run (MO3). Any other step is refused (`nothing_to_open`); a unit not started yet is refused with `norn tick`.
- MO4 Attended steps relax the unattended machinery: no `silent`, nudges, deadline or `stalled`; the `Stop` hook does not block turn end. Only `died` and an explicit `done` / `stuck` count. The agent reports `done` once the person agrees. An attended run waiting for its person is shown as Your turn after `limits.attended_wait`; this records no outcome (SPEC-herdr-cockpit HC1–HC3).

## 7. Repository layout

```
.agents/
  norn/
    config.yaml                 # repo config (agents, runner, remote, label, defaults, checks)
    workflows/                  # story.yaml, slice.yaml, bug.yaml — examples copied by init, editable
    trace/                      # gitignored: JSONL per tick, hook events, briefings, transcripts
  specs/<id>-<slug>/            # id is provider-prefixed: gh-123, gl-45
    spec.md                     # frontmatter mirrors remote issue + workflow + spec body
    slices/<nn>-<slug>.md       # frontmatter: id, title, workflow, depends_on, status, labels?
    pr.md                       # story PR body, written by an agent (GR9); prose, never read by decide
    runs/<unit>/                # <unit> = _story or a slice <nn>-<slug>; committed, collapsed in PR diffs (S10)
      state.json                # commit point: cursor, attempt, counters, workflow_hash, applied_through
      workflow.yaml             # workflow copy pinned when the unit started
      receipts/NNNN-<kind>.json # immutable inputs: done / ask / stuck / answer / approve / reject / unstick / mode / check / started / classify
      logs/<run_id>.log         # full check output, committed only on fail
      evidence/<run_id>/        # QA evidence
      handoff.md                # generated status header + Goal / Progress / Resume
refs/norn/claims/<story-id>     # git ref: claim blob (holder, heartbeat_id, expires_at, last tick_id)
refs/norn/inbox/<story-id>/<ulid> # git ref: receipt from a non-holder (M3)

~/.norn/
  config.yaml                   # user layer, same schema as repo config; machine caps live here
  leases/                       # runtime only: agent and port slot leases
```

The story worktree is on the story branch and holds `.agents/specs/<id>-<slug>/`; it is created at intake, and `spec.md` is never written in the main checkout. Worktrees contain a `.norn-unit` marker and a `.env.norn` (`NORN_SLOT`, `PORT_BASE`, …).

### 7.1 State ownership

| Layer | Written by | Committed | Purpose |
|---|---|---|---|
| Frontmatter (story/slice) | humans, `norn-refine`/`norn-slice` skills; CLI changes only coarse `status`, `workflow` (via `norn story edit --workflow`) and mirrored remote fields | yes | intent |
| `runs/<unit>/` JSON, `workflow.yaml`, logs, evidence | CLI only | yes | machine state |
| `handoff.md` | CLI writes the status header and heartbeat lines; agents and humans write Goal / Progress / Resume | yes | context for the next agent or person |
| Claim and mailbox refs | CLI only | pushed refs | atomic ownership, remote receipts |
| `trace/` | CLI only | no | debugging, `run view --why`, `retro` |
| `~/.norn/leases/` | CLI only | no | machine-wide caps and slots |

### 7.2 Run state

- S1 All JSON writes are atomic (temp file + fsync + rename) and validated against `@norn/schema` on every read.
- S2 A file failing validation marks its unit `corrupt`; the tick never guesses and never starts over.
- S3 Each unit (the story or one slice) writes only its own `runs/<unit>/`, so parallel slices never conflict.
- S4 Commits made by norn carry trailers `Norn-Story`, `Norn-Slice`, `Norn-Step`, `Norn-Tick`.
- S5 **`state.json` is the truth** and the commit point: it is written last. It holds the cursor, attempt, counters, `workflow_hash` and `applied_through` (the last applied receipt number). Counters exist only there, never in memory.
- S6 **Receipts are inputs.** `receipts/NNNN-<kind>.json` are immutable and written first. Each carries `receipt_id`, `run_id`, `step` and `attempt`. Each tick applies every receipt numbered above `applied_through`, then rewrites `state.json`; a crash between the two re-applies idempotently on the next tick.
- S7 **Workflows are pinned per unit.** At unit start the workflow is copied to `runs/<unit>/workflow.yaml`. Editing the repo workflow affects new units only; a running unit adopts a change only through `norn story edit <unit> --workflow <name> --at <step>` (journaled). If the cursor's step no longer exists, the unit goes `stuck`.
- S8 **Commit and push at step boundaries only**: when a receipt lands or a step is classified. The commit contains the agent's work, `runs/<unit>/` and `handoff.md`. The claim holder then pushes the unit's branch (story or slice). Per-tick details stay in `trace/`.
- S9 **`handoff.md` is context, never state.** Its top block is rendered from `state.json` on every commit (story, slice, step, attempt, counters, last outcome, next command), marked "do not edit", and never parsed back. `brief` includes it; `story checkout` prints it.
- S10 **`runs/` is collapsed in PR diffs.** `norn init` adds `.agents/specs/*/runs/** linguist-generated=true gitlab-generated=true` to `.gitattributes` if missing, so GitHub and GitLab fold receipts, state, logs and evidence in a PR diff and the review shows the work. The files are still committed and pushed (S8).

## 8. Heartbeat

- H1 `norn tick` is one idempotent pass: **observe → decide → act → log**, under a local lock.
- H2 **Observe** collects facts: frontmatter, `runs/` state and unapplied receipts, git refs (local and remote, incl. mailbox), worktree status, runner pane state, hook events, process liveness (PID + start time).
- H3 **Decide** is a pure function `(facts, pinned workflows, config) → actions`, at most one action per unit per tick. It records which rule fired.
- H4 **Act** performs actions, writing receipts first (P6); every action and its result is appended to the trace.
- H5 `norn watch --interval 30s` runs ticks in a loop; cron/launchd may be used instead. Remote calls (sync, claim beats, mailbox fetch) are throttled and never block local reads.
- H6 Performance: `tick`, `brief`, `status`, `story list` complete in < 1 s on local state.
- H7 Claim renewal is a **side action** (R1): decide emits it beside a story's one unit action; act renews first and, when the renewal's CAS is lost, skips the story's other actions this tick (`skipped: claim lost`), so merge cleanup and receipt application never starve.
- H8 Act failures are never `ok: true` (R4.3): an action whose effect failed (send, resume, launch, push, answer delivery) reports `ok: false`; the unit's last failure is kept machine-local, shown in `status` and as an Unblock item until an effect of the same kind succeeds.
- H9 Every tick writes `tick.start` before act and `tick.end` after (R5.4); `norn run view --why` shows a tick with no end as "tick crashed during act".
- H10 `heartbeat.json` records `last_tick_at` (R5.5). Older than 3 × watch interval while a held story has auto work → Unblock item "no heartbeat on <holder> for 7m — run `norn watch`", and auto steps lose their manual start hint.
- H11 Every call that reaches a remote (`git fetch`/`push`/`ls-remote`/`pull`/`clone`, every `gh` and `glab` call) has a timeout (2 min). On timeout its whole process group is killed (git and the `ssh` it started) and the call fails as a retryable network error, so a connection dropped while the machine slept never holds the tick lock (H1). Local git calls have no timeout: a commit runs hooks.

## 9. Agent integration

### 9.1 Hooks

- A1 `norn init` appends norn hooks into each configured agent tool's repo config (e.g. `.claude/settings.json`), marked as norn-owned; re-running updates them in place; `norn uninstall` removes them.
- A2 Hooks call `"${NORN_BIN:-norn}" hook <event>` (R8.1) and report lifecycle facts: turn start/end, tool use, waiting for input (incl. permission prompts), session end, transcript path. Each fact is appended to the unit's own hook file (`trace/hooks/<story>/_story.jsonl` or `<nn>.jsonl`, the unit of the worktree it fired in, with or without a run id) and to the trace day file. Ticks, `norn hook` and `norn brief` read a unit's hook facts from its hook file only, never from the day files; a tick reads the hook files of units with a live run or an unknown launch (R5.1) and of units whose hook file was written within `limits.stalled` (R5.3). The first tick of a norn with hook files copies each live run's hook lines from the day files into its unit's hook file once, deduplicated by event id, and records it in `trace/hooks/backfill.json` (`since`, the units `done`; never pruned); runs begun after `since` need no copy.
- A3 Hooks are no-ops outside worktrees containing `.norn-unit`.
- A4 Where the agent supports blocking (e.g. Claude Code `Stop`), ending a turn without a receipt is refused with an instruction to report — in unattended steps only (MO4). The refusals already given to a run are counted from its unit's hook file (A2).
- A5 Agents without hooks are a lower tier: runner, process and git facts only.
- A6 When launching, norn sets `NORN_HOME`, `NORN_STORY`, `NORN_SLICE`, `NORN_RUN` and `NORN_BIN`. The launched command itself starts with `env PATH=<shim dir>:… NORN_BIN=<shim>`, where the shim `~/.norn/bin/norn` execs the launching norn, so `command -v norn` in a runner pane resolves to it even after a login shell resets `PATH` (R8.1).
- A7 `norn doctor` (M4) runs a test turn per adapter and verifies hooks fire; it runs `command -v norn` in one throwaway runner session and fails when it resolves to another norn (R8.2), and warns when `NORN_MACHINE` overrides the machine name (R7.3).

### 9.2 Sessions and briefing

- B1 Each step gets a **fresh agent session**; context passes between steps only via files (handoff, receipts, diff).
- B2 Within a step, nudges, answers and resumes go into the **same session** (pane input / `--resume`) while counters allow; if the session is gone, a fresh session for the same step starts from the handoff.
- B3 `norn brief [--json]` renders the briefing from data only:

| Section | Source |
|---|---|
| Where you are (story, slice, step, attempt, effective mode, attended) | `state.json` |
| Your job (skill, optional instructions) | pinned workflow step |
| Inputs (spec, slice file, diff range) | step `inputs` + frontmatter |
| Rework (when entered from a failure) | latest failing `check` receipt + log, or findings from the `review`/`qa` receipt that sent it back |
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
- C5 Every `check` run writes a check receipt `{run_id, command, exit_code, duration, output_tail}` (last ~200 lines); on `fail` the full output goes to `runs/<unit>/logs/<run_id>.log` and is committed.

### 10.1 Criteria, verdicts and notes (QV1–QV8, NT1–NT4, `SPEC-base-sync-and-qa.md` Part B)

- QV1 Slice frontmatter (and story frontmatter, for story-level QA) may list `criteria: [{ id, verifier: test | agent | person, needs?: [capability] }]`, written by the `slice` skill next to the prose Acceptance section. Decide never reads the prose (P8).
- QV2 `norn done --criteria <file>` takes a JSON array validated against the `CriteriaReport` schema: one entry per criterion with a verdict — `pass` (`evidence` required), `fail` (`repro` required), `person` (`how` required), `unverified` (`reason` and `how` required: a machine could check it, this session could not). The report is stored in the `done` receipt (`criteria`).
- QV3 An agent step with `criteria: required` refuses `norn done` without a report (`criteria_required`); so does an outcome gated by a `verdict`.
- QV4 With frontmatter `criteria`, the report covers exactly those ids, once each; otherwise `invalid_criteria` (exit 3) with the expected ids in `do_instead`. Without frontmatter `criteria`, coverage is not checked and the trace records `criteria.unchecked_coverage`.
- QV5 An outcome edge may declare `verdict: <v>` (agent steps only, W5). Order `fail` > `unverified` > `person` > `pass`; an outcome with `verdict: v` may be reported only when the worst verdict in the report is `v` — otherwise `outcome_contradicts_verdicts`, and `do_instead` names the outcome that matches.
- QV5a `pass` means observed in this session. Each agent declares what its sessions can do in config, `agents.<name>.capabilities: [browser, …]` (default none). `norn done` refuses (`pass_without_capability`, exit 3) a `pass` verdict for a criterion whose `needs` are not all among the reporting agent's capabilities; `do_instead` says to report it `unverified` with `reason` and `how`. A person's earlier gate ruling (the brief's Rulings) answers questions but never verifies a criterion on the current code (C2).
- QV6 Default `qa` steps (story and slice) declare `criteria: required` and `pass` (verdict pass), `fail` (fail, counted), `partial` (person → `human-qa`), `unverified` (unverified → `human-qa`). A workflow may route `unverified` to an agent step whose runner has the capability instead.
- QV7 A gate's inbox item lists the `person` and `unverified` criteria of the report that led there, with `reason` and `how` (one line in `detail`, one per line in `full` / `status --details`); a rework brief after a rejection repeats the judged report's criteria not passed.
- QV8 Each report is a `criteria` trace event (counts per verdict, `unverified` per capability in `needs`); `norn run list <unit>` sums them (`criteria.unverified_needs`).
- NT1 Every `norn done` accepts `--note "<text>"` (repeatable), each optionally followed by `--note-criterion <id>`; stored in the `done` receipt (`notes`). Notes never block and never change the route.
- NT2 Each open note is a Notes item `note:<receipt_id>:<n>` (`qa note on gh-4/01 (AC3): …`, command `norn run view gh-4/01 --receipt <id>`). Notes are information, not an action: the Notes group sits below Running, does not count as needing a person, and its items refuse approve/reject.
- NT3 Every story-level gate lists the story's open notes in its inbox item. Approving it records them in the `approve` receipt (`acknowledged_notes`), and they leave the inbox; rejecting leaves them open.
- NT4 The `qa` skill uses a note, not `person`, when a criterion passed as written but a person may read it differently.
- NT5 The Notes header says when its notes clear: `cleared by <story> <gate> approval`, naming the nearest story-level gate ahead of the story unit's step (its own when it waits at one), else `cleared when the story is done`. A slice gate's item lists that slice's open notes too; approving a slice gate does not acknowledge them.
- NT6 `norn status` shows Notes as their header line only, with `norn status --notes` beneath; `--notes` lists them. The JSON always carries every note. The cockpit shows them as an accordion (SPEC-herdr-cockpit HC16).

## 11. Workflows

- W1 Files in `.agents/norn/workflows/*.{yaml,json}`, validated against a published JSON Schema. No lifecycle is hard-coded; `init` copies `story`, `slice`, `bug` as **examples** with no implied mapping.
- W2 Step types:

| Type | Purpose |
|---|---|
| `agent` | Run a skill in a fresh session; fields: `skill`, `instructions?`, `inputs`, `agent?`, `model?`, `attended?`, `criteria?: required` (QV3), limits (`deadline`, `nudges`, `retries`), `outcomes`. |
| `check` | Run a shell command in the unit worktree with `.env.norn` loaded and a `timeout`; exit code decides `pass`/`fail`; writes a check receipt (C5). |
| `gate` | Wait for a human `approve`/`reject` (or `answer`). |
| `git` | Built-in actions: `integrate` (slice into story branch: rebase + fast-forward, serialized per story), `push`, `open-pr` (draft story PR into the base branch, BS0; body per GR9, and an open PR gets the new body), `update` (merge the base into the story branch, BS3). |
| `slices` | Story-level bridge: start each slice's workflow when its `depends_on` are done, within caps; `done` when all slices are integrated; picks up slice files added mid-flight. |

- W3 Transitions are keyed on outcomes: `review.changes_requested → implement`. Conditions are expressed only as outcomes (e.g. `refine` reports `done` or `questions`); there is no `when:` guard in v1. An edge is `{ to, counter?, means?, verdict? }`; `verdict` (agent steps only) gates which outcome a criteria report allows (QV5).
- W4 Every **elementary cycle** (a path back to its start visiting no step twice) must include at least one edge with a `counter`. Taking a counted edge increments it; if it would exceed `max`, the edge is not taken and the outcome becomes `exhausted` → `$stuck` with the reason (e.g. "review_loop 3/3 at review.changes_requested"). Counters are per unit and never reset by themselves, except a counter declaring `reset_on: <step>.<outcome>`: taking that edge resets it to 0, journaled with the advance (trace, commit, handoff line) — e.g. `base_conflict_loop` resets on `update.done`, so only repeated conflicts on one base move count (C3). Otherwise only `norn run rerun --reset <counter>` resets one, journaled. `reset_on` must name a declared edge (W5); it never exempts a cycle from needing a counter.
- W5 Load-time validation: schema; every step can reach `$done`; every elementary cycle has a counter (the validator lists each uncounted cycle with its path); every referenced skill is installed for the agent that runs the step (SK1); no step uses a reserved name; `verdict` only on outcomes an agent reports (QV5). Invalid workflows are refused before anything runs.
- W6 v1 has no `fork/join`; parallelism comes from independent slices.
- W7 **Reserved targets** start with `$`: `$done` (unit finished) and `$stuck` (park in inbox under Unblock with the reason). `$stuck` is always an implicit target of `exhausted`, `stuck` reports and C1 routes. Step names may not start with `$` nor be a reserved word: `done`, `stuck`, `ask`, `exhausted`, `silent`, `died`, `timeout`, `stalled`, `stale`.
- W8 **Workflows are not tied to a level.** Any workflow may run on a story or a slice; constraints are checked at unit start: `slices`, `git: open-pr` and `git: update` only on a story, `git: integrate` only on a slice. A story workflow without `slices` works directly in the story worktree.
- W9 **Workflow selection.** A story's workflow is `workflow:` in `spec.md`, set at intake from a remote label `norn:wf:<name>` if present, else `config.default_workflow`; changeable before start with `norn story edit <story> --workflow <name>`, after start only with `--at <step>` (S7). A slice's workflow is `workflow:` in its frontmatter, proposed by the `slice` skill, editable at the plan gate, default `config.default_slice_workflow`.

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
      approve:           { to: qa, means: "all criteria met, no blocking findings" }
      changes_requested: { to: implement, counter: review_loop, means: "blocking findings in the receipt" }
  qa:
    type: agent
    skill: norn-qa
    criteria: required
    outcomes:
      pass:       { to: integrate, verdict: pass, means: "every criterion observed with evidence" }
      fail:       { to: implement, counter: qa_loop, verdict: fail, means: "a criterion fails; repro in findings" }
      partial:    { to: human-qa, verdict: person, means: "criteria only a person can judge, evidence prepared" }
      unverified: { to: human-qa, verdict: unverified, means: "criteria this session could not check; how to check each one is in the report" }
  human-qa:
    type: gate
    outcomes: { approve: integrate, reject: { to: implement, counter: qa_loop } }
  integrate:
    type: git
    action: integrate
    outcomes: { done: $done, conflict: { to: merge, counter: conflict_loop } }
  merge:
    type: agent
    skill: norn-merge
    outcomes: { done: integrate }
counters: { test_loop: { max: 5 }, review_loop: { max: 3 }, qa_loop: { max: 2 }, conflict_loop: { max: 2 } }
```

Default story workflow (sketch): `refine (attended; done → plan, questions → clarify) → clarify (attended) → plan (attended) → slice → approve-plan (gate) → slices → update (git; conflict → resolve, counted) → test (check) → qa → describe (writes pr.md, GR9) → open-pr (git) → ready (gate) → $done`; `human-qa` approve also goes to `describe`; `human-qa` and `ready` route `stale` back to `update` (counted, `stale_loop`), workflow field `base: { stale: conflict }` (BS6–BS8). Rework found by story `test`/`qa` goes to `implement` in the story worktree, counted. After `$done` the story waits for the observed PR merge (GR6) — a fact, not a gate.

Example `bug` workflow: `reproduce (agent, norn-diagnose: seen as a user, then a red loop and the cause, no fix; reproduced → implement, cannot_reproduce → $stuck) → implement (the loop becomes the red test) → test → review → integrate`.

## 12. Remote and git

- GR1 `norn sync` (also run by `tick`, throttled ~5 min) uses `gh`/`glab` to list issues assigned to the user with the configured label (default `norn`).
- GR2 Intake: create the story branch and story worktree, write `.agents/specs/<id>-<slug>/spec.md` there mirroring provider, number, URL, title, assignee, body and `workflow` (W9); start the story workflow. A spec folder an older norn wrote holds `story.md` instead: norn reads and writes that file while the folder has no `spec.md`, and never renames it.
- GR3 Story branch `<id>-<slug>`; slice branches `<id>/<nn>-<slug>` cut from the story branch, each in its own worktree.
- GR4 Only the CLI rebases, integrates and pushes. Pushes happen at every step boundary (S8), so every step boundary is a handoff point.
- GR5 A person merges the story PR.
- GR6 **PR merged** → story `done`: remove story and slice worktrees, delete slice branches (local and remote) and the local story branch, delete claim and mailbox refs. The spec folder with `runs/` and `handoff.md` stays in the base branch as the record.
- GR7 **PR closed unmerged, issue closed, unassigned or unlabelled** → the story parks with reason `remote: <what>` under Unblock. norn never deletes work on its own; `norn story close <story>` cleans up (pushing branches first, as `story handoff` does); `norn run rerun` resumes.
- GR6a (BS11) **Merged means merged into the base.** GR6 cleanup fires only when the PR's base branch (`story.pr.base_branch`) is the story's base branch (BS0), or the story head is already on the fetched base (P2). A PR merged into any other branch parks the story with reason `remote: PR merged into <branch>, not <base>` (GR7); an open PR targeting another branch is a Check item (retarget).
- GR8 **Issue edited** → mirrored frontmatter fields (title, assignee, URL) update; the spec body is never overwritten. If the remote body changes after `refine` finished, an inbox item "issue body changed since refine" appears; it does not block running slices.
- GR9 **PR body.** An agent step (the template's `describe`, skill `norn-pr`) writes the body to `<spec_dir>/pr.md`: a summary picture, before/after evidence from QA, merge danger. `open-pr` reads the file as opaque text in act — decide only names it (P8) — and puts the issue link (`Closes <url>`) under it; with no file the body is the link alone. When the story's PR is already open, `open-pr` replaces its body instead of opening another, so after rework the PR describes the branch as it is now. A body edited by hand on the remote is overwritten: edit `pr.md`, or reject at `ready` with what to change.

### 12.1 Base sync (BS0–BS10, `SPEC-base-sync-and-qa.md` Part A)

- BS0 The **base branch** is config `base_branch` when set, otherwise the remote's default branch as discovered — never assumed to be `main`. A story's **base ref** is `refs/remotes/<git_remote>/<base>` when the git remote exists, else `refs/heads/<base>`. Intake cuts story branches from it; `open-pr` targets it.
- BS1 Observe adds per story `story.base {ref, sha, head, merge_base, behind, ahead, conflicts}`. `conflicts` comes from `git merge-tree --write-tree --name-only --no-messages <story head> <base sha>`, computed only when the pair (story head, base sha) changed since the last measurement (cache `.agents/norn/trace/base.json`); the facts are in the trace, so `norn run view --why` replays them.
- BS2 `norn doctor` requires git ≥ 2.38 (`merge-tree --write-tree`); `norn watch` refuses to start a heartbeat otherwise.
- BS3 `git: update` (story units only, W8), in the story worktree: a dirty worktree → `$stuck` (`worktree dirty`); takes the story's integrate lock (K6); adopts the remote story branch when it is a fast-forward of the local one (a person pressed "Update branch"), `$stuck` (`story branch diverged from <remote>`) when they diverged; `behind == 0` → `done`, no commit; else `git merge --no-ff <base sha>` with message `Update <story> from <base> (<short sha>)` and the `Norn-Tick` trailer (Q6), pushed at the step boundary (S8, T7) → `done`; a conflicting merge is aborted → `conflict`, with the base sha and the conflicting paths in the classify receipt (`base`).
- BS4 **Merge, never rebase** the story branch: it is published (draft PR, T5), slice branches are cut from it (GR3) and the ready gate pins its head (F35). GR4 is unchanged.
- BS5 The `resolve` step runs the `merge` skill on the base: its brief's Rework carries the base sha, the conflicting paths and "merge `<sha>` into the story branch in this worktree, resolve, commit the merge; never rebase". Conflicts are resolved by intent (both sides' commits, this story's spec and criteria, the base change); a resolution needing new behaviour aborts the merge and reports `norn stuck "<why>"`. On `done` the workflow returns to `update`. The agent's merge commit is never a foreign commit: commits made during a run of the unit — from its first to its last receipt, open-ended while it runs or is parked on an ask — are the agent's (Q6, C4).
- BS6 Classified outcome `stale` at a story gate (§10), only through a declared `stale` route; otherwise only the BS10 inbox item.
- BS7 A story is **stale** when `base.conflicts` is non-empty (default), or with workflow field `base: { stale: behind }` when `base.behind > 0`.
- BS8 Taking a `stale` route writes a `classify` receipt `{outcome: stale, rule: "base moved", detail: "<n> behind, conflicts: …", base}`; the edge back carries a counter (W4; default `stale_loop: { max: 10 }` — a stale re-entry is progress from outside, bounded by the sibling merges). The default `base_conflict_loop: { max: 2, reset_on: update.done }` counts conflicts per base move, not per story (C3).
- BS9 `norn story update-branch <story>` re-enters the step named by workflow field `base.step` (default: the first `git: update` step) when the story unit is done with an unmerged PR, parked at a gate, or stuck, and only while this checkout holds the claim (T7; never through the mailbox); refused otherwise with `do_instead`. It writes a receipt `update {from, to, reason: "person"}` before the state change (P6, S5). Re-entering from `$done` passes the ready gate again (F35): `ready_head_sha` comes only from an `approve` receipt newer than the unit's last re-entry (`update`, `workflow`), so the old approval raises no "head changed" item (C5). The tick never moves a done unit by itself.
- BS10 Inbox: a Check item per stale story (BS7) waiting at a gate without a `stale` route or stuck — `gh-3 conflicts with main in a.ts, b.ts (4 behind)`, command `norn story update-branch gh-3`, id `stale:<story>:<base sha>`; the "Merge PR #N" item shows `behind <base> by N` and, when conflicting, its command is `norn story update-branch <story>`. PRs are fetched only on sync ticks, so each checkout keeps the last PR it saw per story with its observation time (`.agents/norn/trace/pr.json`, `story.pr_seen`); the PR items (merge, retarget GR6a, head changed F35) use it on the ticks between syncs and in `norn status`/`status`, and stay put instead of flickering. Decide acts only on a freshly fetched `pr` (C1).

## 13. Claims and team handoff

- T1 Claims are per **story**: one heartbeat drives a whole story; slices are scheduled locally by it.
- T2 Claim ref `refs/norn/claims/<story-id>` holds a blob: holder (`user@machine`), `heartbeat_id`, `expires_at`, last `tick_id`.
- T3 Acquire and renew via compare-and-swap: `git push --force-with-lease=<ref>:<expected>`. Losing the race fails with "held by X since Y".
- T4 **Beat lease**: each live tick renews (e.g. 10 min lease, renewed ~3 min). Liveness is the beat, never the claim age.
- T5 `norn story checkout <story>` succeeds after expiry, pulls the story and slice branches and resumes from `runs/` + `handoff.md`. Before expiry it requires `--force`. Every take, forced or not, writes a `take` trace event and a `take` receipt `{previous_holder, previous_heartbeat_id, expired}` on the story unit before any other effect; `run list` and `run view --why` show it (R10).
- T6 **Parked is not released.** A story parked on `ask`, `stuck` or a gate keeps its claim and the heartbeat keeps renewing it. The claim is released only by `norn story handoff <story>` (pushes branches and handoff first, then deletes the ref), a clean `watch` exit, or lease expiry.
- T6a `story handoff` (incl. a `watch` exit) pushes a story branch only while this heartbeat holds the claim and the push is a fast-forward; otherwise it deletes nothing and says why (R3.3).
- T7 Only the claim holder pushes the story and slice branches, and writes receipts for the story (R2.2). The tick that applies a receipt commits and pushes in the same tick; `started` receipts are committed in the launch tick (R2.1).
- T7a A non-holder checkout reports `runs/` work (receipts, state) that exists locally but not on the remote unit branch as a Check item "local work on gh-9 is not in the record (0035-done) — the story is now held by X"; `norn tidy` moves it to `runs/<unit>/orphaned/<holder>-<file>` on the local branch only, never pushed (R2.3).
- T7b An intake that loses the claim CAS removes what it created on this checkout when it holds no further commits, else keeps it and raises T7a (R3.1). Decide never acquires a story whose record on the base ref says `done` or whose PR merged — the base record wins over any local spec (R3.2). A story's record is read only from its own worktree (`.norn-unit`) or the base ref (R3.4).
- T7c Runs record `machine` (`user@host`) and `heartbeat_id` in their `started` receipts (R7.1). Process and pane liveness are checked only for runs of this machine; a run from another machine is judged by its hooks and the claim — after a `story checkout`, no hook activity in the stalled window → `died` with rule `foreign run, holder changed` (R7.2). `NORN_MACHINE` overrides the machine name, as a test aid (R7.3).
- T8 `story approve`, `story answer`, `run rerun` acquire the claim for the local heartbeat when it is free.
- T9 **Mailbox (M3).** A non-holder's `story approve` / `story answer` / `run rerun` is pushed as a blob to `refs/norn/inbox/<story-id>/<ulid>`. The holder's tick fetches mailbox refs during sync, copies each into `runs/<unit>/receipts/` as the next numbered receipt, commits, pushes, and deletes the ref. A receipt whose `step`/`attempt` no longer matches is rejected into the trace. Before M3 the CLI refuses with `do_instead`.
- T10 Stories are never picked up automatically except at intake; unclaimed stories show in `status`/`story list` as "Unclaimed — `norn story checkout <story>`".

## 14. Concurrency and resources

- K1 `max_agents` (default 2) and `max_checks` are **per machine**, across all repositories and stories. Extra ready steps queue: oldest story (by intake time) first, then slice number.
- K2 Configuration has one schema in two layers: `~/.norn/config.yaml` (user) and `.agents/norn/config.yaml` (repo). The repo overrides the user layer, except that machine caps (`max_agents`, `max_checks`, slot range) can only be lowered by a repo.
- K2a `norn config list` (`norn config get <key>` for one) prints the resolved configuration: each setting with its value, the layer it came from (built-in, user, repo), a repo value a machine cap ignores, and a note where the layering hides something (a repo setting a machine key, `default_mode: auto` with no runner, an agent's own permission mode). Read only.
- K3 Agent and port slots are lease files in `~/.norn/leases/`, created atomically (`O_EXCL`) with repo, unit, `run_id`, PID and start time. Dead holders are reclaimed by PID + start-time check. Leases are not committed; another machine allocates its own.
- K4 Each worktree gets a slot (`NORN_SLOT`, `PORT_BASE`, optional extra per-slot resources from config) in `.env.norn`.
- K4.1 Before a check runs, every process listening on the worktree's slot ports (`PORT_BASE` … `PORT_BASE + ports_per_slot - 1`) whose working directory is inside that worktree is stopped (SIGTERM, then SIGKILL after 2 s) and named at the top of the check output: a server an agent left running must not fail the check with "address in use". Listeners started elsewhere are left alone; without `lsof` nothing is stopped.
- K5 The tick creates slice worktrees when a slice starts and removes them after integration. `norn tidy [--dry-run]` reports or cleans orphans; each tick reports them.
- K6 Integration into the story branch is serialized per story — slice `integrate` and the story's base `update` (BS3) take the same integrate lock (`.agents/norn/trace/integrate-<story>.lock`); a non-clean rebase or merge yields `conflict` and routes via the workflow.
- K7 With Herdr as the runner, `norn tidy` also closes what runs that reported `done` left in Herdr: the run's tab, or only its pane when the tab holds something else, and its workspace when nothing else is left in it. A run counts only when its `started` receipt recorded a Herdr pane on this machine; the pane is found by that id and must still work in the run's worktree, and one whose agent is still working is kept. Runs that ended any other way (ask, stuck, died) are left alone. `--dry-run` lists them; a Herdr that cannot be reached is reported under `kept`, and the rest of tidy still runs. Closing happens only in `tidy`, never after a run on its own.

## 15. Human interface and observability

**Commands (v1)**

A noun tree modelled on gh: nouns are things a person can see, verbs are shared across nouns. A verb's target defaults to the unit of the current worktree; at a terminal a missing target prompts with only the units the verb applies to. `norn help` lists the tiers below; `help --all` adds the hidden one.

| Tier | Command | Verbs |
|---|---|---|
| Core | `norn status [--details] [--notes] [--history]` | what needs you, across every story (O1); `norn status --watch [--interval] [--pane]` is the cockpit, `--pane` in a Herdr split below |
| Core | `norn story <verb> [<story\|slice>]` | general: `norn story create`, `norn story list`, `norn story view [--web]`; decision: `norn story answer`, `norn story approve`, `norn story reject --reason`, `norn story update-branch` (BS9); work: `norn story start [--print]` (MO5), `norn story chat`, `norn story edit [--auto\|--manual] [--workflow <name> [--at <step>]]` (MO1, S7); team: `norn story checkout [--force]` (T5), `norn story handoff` (T6), `norn story close` (GR7), `norn story reopen` |
| Core | `norn run <verb> [<run\|unit>]` | `norn run list` (O4), `norn run view [--why \| --receipt <id>]` (O5), `norn run attach [--next]`, `norn run rerun [--step <step>] [--reset <counter>]`, `norn run cancel` |
| Setup | `init`, `doctor` (M4), `config list\|get\|set\|unset` (K2a), `uninstall` | |
| Background | `watch`, `sync`, `tidy` | |
| Agent protocol | `brief`, `done`, `ask`, `stuck` | |
| Hidden (`help --all`) | `tick`, `hook`, `status --segment` | |

A removed command name (`drop`, `inbox`, `orient`, …) is an unknown command (usage error, exit 2).

- O1 `norn status` (and the cockpit, `norn status --watch`) groups by action: **Your turn** (attended steps), **Answer**, **Approve**, **Unblock**, **Check**, **Unclaimed**, **Running**, **Notes** (NT2), **Recently done**; each group title carries a few words on what it holds, and each item shows question/reason, age and the exact command to resolve it. A person's start of an agent step (Your turn) shows `norn story start <unit>` when the runner can open a terminal (MO5), with the start command to type by hand in the detail; otherwise the start command itself. A story taken in on this checkout that no tick has started yet is listed too: under Running while the heartbeat is up, else under Your turn with `norn watch`. `norn status --watch` acts on the items through CLI verbs (SPEC-herdr-cockpit HC4–HC8).
- O2 `story answer`, `story approve`, `story reject`, `run rerun`, `run cancel` and `story edit` (mode, workflow) write receipts; the next tick applies them and delivers answers into the same session or a fresh one from the handoff. Typing directly into an agent pane is also allowed.
- O3 Notifiers are optional plugins (OS default; ntfy, webhook, herdr) and fire once per new inbox item, receipt-first.
- O4 Trace: one JSONL record per tick with facts snapshot, rule fired, action, result, briefing and transcript pointers. The record keeps its decisions inline and stores the facts snapshot as a skeleton marked `"$chunked": 1`: each story's facts, the machine facts, the remote issues, the replay config and each workflow source are chunks addressed by the sha256 of their JSON, and each run's hook facts are blocks of 64 cut by position, written once. Chunks live once in the day's `<day>.chunks.jsonl` beside the day file, appended and fsynced before the tick line that names them, so no tick line names an unwritten chunk and one day's two files replay every tick of that day. A record without the marker is a full-facts snapshot and is read as before.
- O5 `norn run view <unit> --why` replays the pure decide function on the recorded snapshot and shows the rule that fired; `--receipt <id>` picks the decision that applied that receipt (the command of a note item, NT2). A chunked snapshot is rebuilt byte for byte as observe produced it; a chunk missing from its day makes the record a corrupt trace entry (exit 4, code `trace_corrupt`, naming the hash) and nothing is replayed.
- O6 `handoff.md`: generated status header (S9); tool writes heartbeat lines (repeats collapsed, e.g. "(×3)"); agents write milestones.
- O7 Trace retention: the trace is machine-local and kept for `trace.retain` (a duration, default `14d`, never less than `14d`, the timelines' window). Only `norn tidy [--retain <duration>]` prunes it, never watch or a tick: it deletes each day file, with its chunks file, dated before today minus the window, and never `trace/workflows/`; `--dry-run` lists each day with the bytes it would free. A window under `14d` or a value that is not a duration is refused by tidy and a warning in `norn doctor`, never a config load failure. `norn doctor` hints, without failing a check, when the trace holds days beyond the window. `norn run view <unit> --why --tick <id>` for a tick older than the window whose day is gone refuses with `tick_pruned`.

## 16. Skills

Single-job skills ported from ai-engine (norn v0.11.0): its skill files are the base, edited only where norn's contracts differ (files in the repo instead of issues and comments; no push, no remote writes; verdicts and findings as structured data; the person's say at gates when no person works with the agent). One skill = one job = one kind of step; reference skills hold the craft several step skills share. Outcomes are declared only in workflows; the "Typical outcomes" column is a suggestion for template authors, not a contract. Every name but `norn` carries the `norn-` prefix so the skills stay apart from a project's own.

| Skill | Job | Typical outcomes |
|---|---|---|
| `norn` | One-step protocol: brief, work in scope, keep handoff, report once, end turn, follow refusals. Only skill aware of norn. | — |
| `norn-interview` | One question per turn until shared understanding; only talks. | done |
| `norn-refine` | Story → spec in `spec.md`: Problem, Solution, numbered Behaviour items (`B1`…, each with an example; edges walked as items), Out of scope, Open questions. Owns the spec layout. | done / questions |
| `norn-clarify` | Sort the open questions, settle them with the person, fold each answer into the section it changes. | done |
| `norn-plan` | The `## Plan` section of `spec.md`: seams, coverage table (Behaviour → seam), prefactoring, implementation and testing decisions, risks. Reference: `norn-codebase-design`. | done |
| `norn-slice` | Plan → tracer-bullet slice files (`workflow`, `depends_on`, acceptance citing Behaviour numbers, frontmatter `criteria` with verifier and `needs` (QV1), check commands); expand–contract for wide refactors. | done |
| `norn-implement` | Test-first build of one slice or story at the Plan's agreed seams, then a review pass. On rework, the points from the brief's Rework section come first: each is a red test, a QA failure gives its repro. Reference: `norn-tdd`. | done |
| `norn-review` | Spec and Standards axes kept apart (a subagent per axis when the agent has them); smells baseline (`SMELLS.md`); findings as structured data. | approve / changes_requested |
| `norn-qa` | Check each acceptance criterion as a user, with evidence (a screenshot for every `browser` criterion); one verdict per criterion in a criteria report (QV2); never pass what wasn't observed (`unverified` when this session cannot check it); notes when a passed criterion may be read differently (NT4); secrets redacted. | pass / fail / partial / unverified |
| `norn-qa-person` | Walk a person through QA from the agent's evidence and their own remarks; a repro for every failure. Shipped for attended QA steps; the templates' `human-qa` is a gate. | pass / fail |
| `norn-pr` | Pull request body from the spec, the diff and QA's criteria reports and evidence: Summary (the smallest picture: pseudocode, call tree, file tree, Mermaid or shape diff), Evidence (before/after per criterion; never claims what was not observed), Merge danger (one-way or two-way door, blast radius). Adapted from mattpocock/skills `pr` (itself after Humanlayer's show-me). | done |
| `norn-diagnose` | Hard bugs, flaky tests, performance regressions: a tight, deterministic loop that goes red on the reported symptom first (no hypothesis before it has gone red), then minimise, ranked falsifiable hypotheses, instrument, bisect; fix behind a regression test at a correct seam, or hand the loop and cause back when told not to fix. HITL loop template (`scripts/hitl-loop.template.sh`); secrets redacted. Runs the `bug` template's `reproduce`; `norn-implement` turns to it when a rework failure does not reproduce on the first try. | reproduced / cannot_reproduce |
| `norn-merge` | Resolve conflicts by intent of both sides; merge the base into a published branch, never rebase; abort and stop if new behaviour is needed. | done |
| `norn-prototype` | Throwaway prototype that settles one design question with a person: a state model as one shareable HTML file (`LOGIC.md`), or radically different UI variants on one route switched by `?variant=` (`UI.md`). Committed on the branch being worked on, in prototype-named files that nothing in the product reaches (real files it edited go back as they were); the spec links its path next to the decision it settled, with the question and the verdict. Not a step: `norn-refine` and `norn-plan` offer it when a decision turns on look and feel or a state model hard to judge on paper, and only suggest it when no person is present. | — |
| `norn-tdd` | Reference: red → green at agreed seams, good tests, mocking at boundaries (`tests.md`, `mocking.md`); refactoring stays out of the loop. | — |
| `norn-codebase-design` | Reference: deep modules, interface, seam, adapter, depth (`DEEPENING.md`, `DESIGN-IT-TWICE.md`). | — |
| `norn-retro` | Retrospective over one finished story, run by a person with an agent after its PR merges, never a step: reads the committed `runs/` of the story and each slice (counters, receipts, check logs, handoffs) and the local `trace/` if present; ranks the friction (exhausted or high counters, repeated rejects, asks, stuck and lost sessions, `unverified`/`person` verdicts, environment check failures, recurring findings) and proposes one change per finding to a skill, workflow, config, contributor docs or the spec template, citing the receipt. Suggests only: answers in the session and writes or changes no file. | — |

- SK1 `norn init` copies each bundled skill folder whole into `.agents/skills/` (committed; always the bundled version, the change visible in `git diff`) and links it from each configured agent's skill folder (`.claude/skills/`, `.gemini/skills/`, `.opencode/skills/`; codex reads `.agents/skills/` itself). A repo customizes a skill by writing its own under another name and naming it in its workflow (W1). `doctor` reports missing, unlinked and drifted skills; W5 checks each step's skill against the skills its agent can see.
- SK2 The `norn` skill must stay under ~80 lines; it never contains workflow logic or step names.

## 17. Architecture and packaging

TypeScript on **Bun**, monorepo with one-way dependencies: `schema ← core ← store ← adapters ← cli`, plus `view`.

| Package | Contents |
|---|---|
| `@norn/schema` | JSON Schemas + generated types: workflow, frontmatter, `state.json`, receipts, trace events, claim blob, config. |
| `@norn/core` | Pure: workflow validation (incl. cycle/counter check), receipt application, decide/reconcile, briefing renderer, outcome classification, adapter interfaces. No IO. |
| `@norn/store` | `.agents/` files, `runs/` JSON, claim and mailbox refs, `~/.norn` leases; atomic writes, validated reads. |
| `@norn/adapter-*` | `git`, `gh`, `glab`, `herdr`, `headless`, `claude`, `codex`, `opencode`, `gemini`, `notify-*`. |
| `@norn/view` | Read model `loadProjectView()` → stories, slices, inbox, runs, timeline. |
| `@norn/cli` | Wiring and commands. |

- X1 Front ends (web cockpit, Herdr pane, TUI) read only via `@norn/view` and write only via CLI verbs. The project view (`loadProjectView`) carries no timeline and reads no trace day file; a front end that shows timelines asks for them with a separate timeline read (`loadTimelines`, or `loadTraceView` for one unit's step timeline).
- X2 Adapters are selected in config by package name; third-party adapters implement interfaces from `@norn/core`.
- X3 Distribution: npm package plus `bun build --compile` single-file binaries. Agent plugins (Claude Code first) are thin wrappers with a `/norn` command; skills come from the repo (SK1), and no logic lives in plugins.
- X4 Core is tested by replaying recorded traces as snapshots (chunked and full-facts records alike, rebuilt by the store's tick read); adapters against recorded fixtures.

## 18. Milestones

| Milestone | Scope | Proves |
|---|---|---|
| **M1 Manual core** (solo, GitHub, Claude) | `init` (config, workflow templates, skills, Claude hooks), `sync`, story worktree, specs/slices/`runs/` store (state.json + receipts + pinned workflows), workflow validation, `brief`/`done`/`ask`/`stuck`, `tick`/`watch`, `check`/`git`/`slices`/`gate` steps, attended steps, story lifecycle (GR6–GR8), `status`, `story list`, `run list`, `run view --why`, `story edit --workflow`, `story close` | Deterministic flow, visible state, file-based handoff |
| **M2 Auto** | Herdr + headless runners, `silent`/`died`/`timeout`/`stalled` classification, bounded nudges, machine caps + queue, port slots, worktree lifecycle, OS notifier | Unattended reliability |
| **M3 Team** | Story claim refs (CAS), beat lease, `story checkout`/`story handoff`, mailbox refs, takeover from handoff | A colleague can continue |
| **M4 Breadth** | `glab`, Codex/OpenCode/Gemini adapters, `doctor` | Agent- and remote-agnostic |

M2–M4 are developed as stories run by norn itself.

## 19. Success criteria

1. 100% of agent runs end in a classified outcome; zero "unknown" in the trace.
2. No step executes twice for the same attempt; no counter is exceeded; zero step transitions made by agents.
3. A scripted test continues a parked slice on another machine from git alone (`story checkout` + `brief`); at least one real handoff during M3 dogfooding.
4. `norn run view --why` explains every action; every human-needed item appears in the inbox within one tick.
5. `tick`, `brief`, `status`, `story list` < 1 s on local state.
6. M2–M4 dogfooded through norn with < X% of steps needing manual intervention (X set after M2).

## 20. Deferred and open

| Item | Status | Note |
|---|---|---|
| Story mode model (MO1–MO3 in §6) | Open | Accepted as assumption; revisit after M2. |
| Planning as a gated step by default | Deferred | Templates can include it; default policy to be decided. |
| Write-back to GitHub/GitLab (draft PR timing, status comment edited in place, `norn:stuck` label) | Deferred | v1 writes only pushes. |
| Agent permission profiles per step (`read`/`write`/`full`) translated per agent | Deferred | v1: permission prompts surface as `ask` in the inbox with the command shown. |
| Hard-deny `PreToolUse` hook (push, `gh`/`glab` writes, edits to `runs/`) | Deferred | Rule is stated in the `norn` skill meanwhile. |
| Redaction of committed machine text | Deferred (post-MVP) | Redact `.env*`/`.env.norn` values, token patterns and `config.redact` patterns from receipts, logs, evidence and handoff; cap receipt tail ~200 lines and logs ~1 MB; transcript snapshots to `trace/` only with a one-line pointer in handoff (changes C4); commit evidence only when the step declares `commit_evidence: true` (default for `qa`). |
| `when:` guards on transitions; per-slice `afk`/`hil` mode with pass-through steps | Deferred | v1 expresses conditions as outcomes and human QA as gates. |
| Per-slice mode | Deferred | `attended: true` on a step covers precise cases. |
| Fast-path story workflow per issue type by label | Partly in v1 | `norn:wf:<name>` label selects a workflow (W9); richer type routing later. |
| Several remotes / projects per repo (`gh-org-repo-123` keys) | Deferred | |
| `norn retro` | Deferred | Mines the trace and proposes allow-list, limit, briefing and workflow changes as diffs for human approval; can itself be a workflow with a `gate`. |
| `fork/join` steps | Out of v1 | |
| Web cockpit | Later | Built on `@norn/view` + CLI verbs. |
| Additional skills (triage, resolve with a person) | Later | |

## 21. Risks

| Risk | Mitigation |
|---|---|
| Agents forget to report | Hooks block turn end without receipt in unattended steps; `silent` classification + bounded nudge + transcript snapshot. |
| Hook APIs differ or change across agents | Adapter per agent, fixture tests, `doctor`; tiered support for agents without hooks. |
| Herdr state is misleading (prior: `done` fired 3× while running) | Herdr is one fact among several; receipts win (C2). |
| Claim ref push races / offline machines | CAS via `--force-with-lease`; lease expiry; explicit `story checkout --force` journaled. |
| Committed `runs/` noise in PR diff | Commits only at step boundaries; small JSON, one directory per unit; marked generated in `.gitattributes` so GitHub and GitLab collapse it (S10). |
| Secrets in committed logs/evidence | Redaction deferred post-MVP (§20); until then, keep check output free of secrets. |
| Workflow edited mid-flight | Workflows pinned per unit (S7); explicit switch only. |
| Prompt rules ignored by models | Limits enforced in code; `norn` skill kept tiny. |
| Workflow complexity creep | Small step-type set, no guards in v1, load-time validation, fixed glossary. |

## 22. Prior art

- **ai-engine (norn v0.11.0):** kept — outcomes not states, refusals with `do_instead`, flows as validated data with reachability, claims as git refs with CAS, craft skills unaware of norn and their text (§16), `.agents/skills/` linked into each agent's skill folder, attended steps, rework through `implement` with findings in the briefing, frozen slugs, banned-synonym glossary. Not repeated — LLM orchestrator (`norn-drive`/`norn-deliver`), labels/comments as store, liveness by claim age, prose output, a single fix-round cap set globally in config, slow `next` (11–18 s).
- **limen:** separate facts (turn end ≠ idle ≠ finished), explicit finish with handoff, idle snapshot of last message, receipts before send, hard limits in code, admission control, one commit-point file written last (atomic + fsync), liveness by PID + start time. Not repeated — LLM coordinator as loop driver, machine-local gitignored state.
- **cezar:** native agent event streams normalised per adapter with fixture tests, named bounded continuation counters, handoff file (Goal/Progress/Resume), YAML workflow graph with `check` and loop counters, workflow definition copied per run, restart is never an answer. Not repeated — fragile text markers as the primary signal, long-lived stateful server, debounced saves, in-memory counters, restarting the walk when a step disappears, starting empty on a corrupt index, gitignored handoff.
