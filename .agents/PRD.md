# norn — Product Requirements Document

Status: draft v1 · Date: 2026-10-23 · Owner: Jakub Pruszyński

## 1. Summary

norn is an agent-agnostic CLI that delivers software stories with coding agents (Claude Code, Codex, OpenCode, Gemini, …) under the control of **deterministic code**. A stateless heartbeat (`norn tick`) reads markdown specs, JSON run state, git and the runner, decides the next action with a pure function, and instructs agents one bounded step at a time. Work is defined in JSON/YAML workflows. State lives in the repository and in git refs, so a team on GitHub or GitLab can hand work over at any commit. norn runs in **manual** mode (a human starts agents) or **auto** mode (norn starts agents), and Herdr is its default — optional — cockpit.

norn is built from scratch. ai-engine (norn v0.11.0), limen and cezar are prior art for ideas only (§17).

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
- G6 Workflows are data (JSON/YAML), editable per repository, validated before use.

**Non-goals (v1)**
- An LLM orchestrator of any kind.
- A server or database; norn is a CLI over files and git.
- Writing status back to GitHub/GitLab beyond pushes (deferred, §16).
- Auto-merging the story PR — a person merges it.
- Permission management for agents (deferred, §16).

## 4. Principles

- P1 **Code decides, agents do.** The tick owns transitions; agents report outcomes and never name states.
- P2 **Pull, don't trust.** The tick observes runner, git and files every time; notifications are never truth.
- P3 **Stateless reconcile.** Everything is re-derived each tick; a killed or restarted heartbeat behaves the same.
- P4 **Facts are separate.** "Turn ended", "pane idle", "step done", "merged" are distinct facts.
- P5 **Bounded everything.** Every retry, nudge and loop has a named counter with a max; exceeding it is a visible `stuck`.
- P6 **Receipts before effects.** Any externally visible action writes its receipt first, so a repeated tick never repeats it.
- P7 **The briefing carries the process, skills carry the craft.**
- P8 **Machine contract is JSON + exit codes**, never prose.

## 5. Glossary

Only these nouns are used in the CLI, docs, schemas and skills (enforced by a lint test).

| Term | Meaning |
|---|---|
| story | A remote issue (GitHub/GitLab) assigned to the user with the configured label. One spec folder, one story branch, one draft PR. |
| slice | A unit of work inside a story. `kind: feature \| bug \| chore`. Own branch and worktree. |
| workflow | A JSON/YAML state machine of steps. |
| step | One node of a workflow. |
| run | One attempt at a step; produces receipts. |
| claim | A git-ref lease giving one heartbeat the right to drive a story. |

Outcomes (`done`, `ask`, `stuck`, `approve`, …) are values, not nouns.

## 6. Users and modes

- **Solo developer** running stories assigned to them, attended or unattended.
- **Team member** picking up a story a colleague (or their machine) released.

**Mode** (per story, repo default in config, switchable with `norn mode <story> auto|manual`) controls one thing — who starts agent steps:

| | manual | auto |
|---|---|---|
| Agent steps | Marked ready; a human opens any agent in the slice worktree, which runs `norn brief` | Tick starts the agent via the runner |
| `check`, `git` steps | Run automatically | Run automatically |
| `gate` steps | Wait for a human | Wait for a human |
| Hooks, receipts, claims, trace | Same | Same |

"Semi-automatic" = auto mode plus gates placed in the workflow. A workflow step may force `manual: true`.

## 7. Repository layout

```
.agents/
  norn/
    config.yaml                 # repo config (agents, runner, remote, label, caps, checks)
    workflows/                  # story.yaml, slice.yaml, bug.yaml (copied by init, editable)
    trace/                      # gitignored: JSONL per tick, hook events, briefings
  specs/<id>-<slug>/            # id is provider-prefixed: gh-123, gl-45
    story.md                    # frontmatter mirrors remote issue + spec body
    slices/<nn>-<slug>.md       # frontmatter: id, title, kind, workflow, depends_on, status
    runs/<slice>/
      state.json                # cursor, step, attempt, counters, last outcome
      receipts/*.json           # done / ask / stuck / answer / approve / unstick
      handoff.md                # Goal / Progress / Resume notes
refs/norn/claims/<story-id>     # git ref: claim blob (holder, heartbeat id, expires_at, last tick)
```

Worktrees contain a `.norn-unit` marker and a `.env.norn` (`NORN_SLOT`, `PORT_BASE`, …).

### 7.1 State ownership

| Layer | Written by | Committed | Purpose |
|---|---|---|---|
| Frontmatter (story/slice) | humans, `refine`/`slice` skills; CLI changes only coarse `status` | yes | intent |
| `runs/` JSON + `handoff.md` | CLI only (agents append to `handoff.md`) | yes | machine state, handoff |
| Claim refs | CLI only | pushed refs | atomic ownership |
| `trace/` | CLI only | no | debugging, `why`, `retro` |

Requirements:
- S1 All JSON writes are atomic (temp file + rename) and validated against `@norn/schema` on every read.
- S2 A file failing validation marks its unit `corrupt`; the tick never guesses.
- S3 Each slice writes only its own `runs/<slice>/`, so parallel slices never conflict.
- S4 Commits made by norn carry trailers `Norn-Story`, `Norn-Slice`, `Norn-Step`, `Norn-Tick`.

## 8. Heartbeat

- H1 `norn tick` is one idempotent pass: **observe → decide → act → log**, under a local lock.
- H2 **Observe** collects facts: frontmatter, `runs/` state and receipts, git refs (local and remote), worktree status, runner pane state, hook events, process liveness (PID + start time).
- H3 **Decide** is a pure function `(facts, workflows, config) → actions`, at most one action per unit per tick. It records which rule fired.
- H4 **Act** performs actions, writing receipts first (P6); every action and its result is appended to the trace.
- H5 `norn watch --interval 30s` runs ticks in a loop; cron/launchd may be used instead. Remote calls (sync, claim beats) are throttled and never block local reads.
- H6 Performance: `tick`, `brief`, `status`, `inbox` complete in < 1 s on local state.

## 9. Agent integration

### 9.1 Hooks

- A1 `norn init` appends norn hooks into each configured agent tool's repo config (e.g. `.claude/settings.json`), marked as norn-owned; re-running updates them in place; `norn uninstall` removes them.
- A2 Hooks call `norn hook <event>` and report lifecycle facts: turn start/end, tool use, waiting for input (incl. permission prompts), session end, transcript path.
- A3 Hooks are no-ops outside worktrees containing `.norn-unit`.
- A4 Where the agent supports blocking (e.g. Claude Code `Stop`), ending a turn without a receipt is refused with an instruction to report.
- A5 Agents without hooks are a lower tier: runner, process and git facts only.
- A6 When launching, norn sets `NORN_HOME`, `NORN_STORY`, `NORN_SLICE`, `NORN_RUN`.
- A7 `norn doctor` (M4) runs a test turn per adapter and verifies hooks fire.

### 9.2 Sessions and briefing

- B1 Each step gets a **fresh agent session**; context passes between steps only via files (handoff, receipts, diff).
- B2 Within a step, nudges, answers and resumes go into the **same session** (pane input / `--resume`) while counters allow; if the session is gone, a fresh session for the same step starts from the handoff.
- B3 `norn brief [--json]` renders the briefing from data only:

| Section | Source |
|---|---|
| Where you are (story, slice, step, attempt, mode) | `state.json` |
| Your job (skill, optional instructions) | workflow step |
| Inputs (spec, slice file, diff range, findings) | step `inputs` + frontmatter |
| Context (handoff, answer to previous ask) | `handoff.md` + receipts |
| Finish with exactly one of (outcomes + `means`, `ask`, `stuck`) | step `outcomes` + universal reports |
| Limits (deadline, nudges left, port slot) | step limits + slot + config |

- B4 The exact briefing of every run is stored in the trace; briefings are snapshot-testable.
- B5 In auto mode the first prompt is one line: "Use the norn skill, then run `norn brief`."

### 9.3 Reporting verbs

| Verb | Meaning |
|---|---|
| `norn done <outcome> --handoff "…"` | Step finished with a declared outcome. The only way a step completes. |
| `norn ask "<question>" [--option …]` | Needs a human answer to continue. |
| `norn stuck "<reason>"` | Cannot continue. |

All CLI output is JSON with exit codes; refusals return `{"error", "do_instead"}`.

## 10. Outcomes and classification

Three sources of outcomes:

1. **Step outcomes** — declared per step in the workflow with `means` text, reported by the agent.
2. **Universal reports** — `ask`, `stuck`, available to every agent step; default route: park → inbox → resume same session.
3. **Classified outcomes** — decided by the tick from facts:

| Step type | Classified outcomes | Rule |
|---|---|---|
| agent | `silent` | turn ended / pane idle, no receipt |
| agent | `died` | process gone, no receipt |
| agent | `timeout` | step deadline passed |
| agent | `stalled` | no hook, git or file activity for the configured window |
| agent | `ask` (implicit) | pane/hook says waiting for input, no receipt (incl. permission prompts — inbox shows the command) |
| check | `pass` / `fail` | exit code |
| gate | `approved` / `rejected` | human receipt |
| git | `done` / `conflict` | command result |
| slices | `done` / `stuck` | aggregate of slices |
| any | `exhausted` | a counter reached its max |

- C1 Default routes: `silent` → nudge in same session (counted) → after max, `stuck`; `died` → retry fresh session (counted) → `stuck`; `timeout`/`stalled` → same as `silent`. Workflows may override any route.
- C2 Receipt presence always wins over runner facts. Runner "idle"/"done" alone never completes a step.
- C3 A restart never counts as an answer; a unit parked on `ask` stays parked until a human answers.
- C4 On `silent`, the tick snapshots the last assistant message (from the transcript), commits and diff into the trace and handoff.

## 11. Workflows

- W1 Files in `.agents/norn/workflows/*.{yaml,json}`, validated against a published JSON Schema. No lifecycle is hard-coded; `init` copies default `story`, `slice`, `bug` templates.
- W2 Step types:

| Type | Purpose |
|---|---|
| `agent` | Run a skill in a fresh session; fields: `skill`, `instructions?`, `inputs`, `agent?`, `model?`, `manual?`, limits (`deadline`, `nudges`, `retries`), `outcomes`. |
| `check` | Run a shell command; exit code decides `pass`/`fail`. |
| `gate` | Wait for a human `approve`/`reject` (or `answer`). |
| `git` | Built-in actions: integrate slice into story branch (rebase + fast-forward, serialized per story), push, open draft PR. |
| `slices` | Story-level bridge: start each slice's workflow when its `depends_on` are done, within caps; `done` when all slices are integrated; picks up slice files added mid-flight. |

- W3 Transitions are keyed on outcomes: `review.changes_requested → fix`.
- W4 Every cycle must name a counter with `max`; exceeding it yields `exhausted` → `stuck` with reason.
- W5 Load-time validation: schema, every step reaches `done`, every cycle has a counter, every referenced skill exists. Invalid workflows are refused before anything runs.
- W6 v1 has no `fork/join`; parallelism comes from independent slices.

Example (slice):

```yaml
name: slice
start: implement
steps:
  implement:
    type: agent
    skill: implement
    outcomes: { done: { to: test, means: "acceptance criteria implemented test-first" } }
  test:
    type: check
    run: bun test
    outcomes: { pass: review, fail: { to: fix, counter: fix_loop } }
  review:
    type: agent
    skill: review
    outcomes:
      approve:           { to: integrate, means: "all criteria met, no blocking findings" }
      changes_requested: { to: fix, counter: fix_loop, means: "blocking findings in handoff" }
  fix:
    type: agent
    skill: fix
    outcomes: { done: test }
  integrate:
    type: git
    action: integrate
    outcomes: { done: done, conflict: { to: merge, counter: conflict_loop } }
  merge:
    type: agent
    skill: merge
    outcomes: { done: integrate }
counters: { fix_loop: { max: 3 }, conflict_loop: { max: 2 } }
```

Default story workflow (sketch): `refine → clarify (gate if open questions) → plan → slice → approve-plan (gate) → slices → open-pr (git) → ready (gate)`.

## 12. Remote and git

- GR1 `norn sync` (also run by `tick`, throttled ~5 min) uses `gh`/`glab` to list issues assigned to the user with the configured label (default `norn`).
- GR2 Intake: create `.agents/specs/<id>-<slug>/story.md` mirroring provider, number, URL, title, assignee, body; create story branch; start the story workflow.
- GR3 Story branch `<id>-<slug>`; slice branches `<id>/<nn>-<slug>` cut from the story branch, each in its own worktree.
- GR4 Only the CLI rebases, integrates and pushes. Each integration is pushed, so every push is a handoff point.
- GR5 A person merges the story PR.

## 13. Claims and team handoff

- T1 Claims are per **story**: one heartbeat drives a whole story; slices are scheduled locally by it.
- T2 Claim ref `refs/norn/claims/<story-id>` holds a blob: holder (`user@machine`), heartbeat id, `expires_at`, last tick id.
- T3 Acquire and renew via compare-and-swap: `git push --force-with-lease=<ref>:<expected>`. Losing the race fails with "held by X since Y".
- T4 **Beat lease**: each live tick renews (e.g. 10 min lease, renewed ~3 min). Liveness is the beat, never the claim age.
- T5 `norn take <story>` succeeds after expiry, pulls the story branch and resumes from `runs/` + `handoff.md`. Before expiry it requires `--force` and is journaled.
- T6 `norn release <story>` pushes branch and handoff first, then deletes the ref. It runs automatically when a story parks on `stuck` or a `gate`.
- T7 Only the claim holder pushes the story branch.

## 14. Concurrency and resources

- K1 Global `max_agents` (default 2) across all stories on the machine; separate `max_checks`. Extra ready steps queue: oldest story first, then slice number.
- K2 Each worktree gets a slot (`NORN_SLOT`, `PORT_BASE`, optional extra per-slot resources from config) in `.env.norn`.
- K3 The tick creates worktrees when a slice starts and removes them after integration. `norn tidy [--dry-run]` reports or cleans orphans; each tick reports them.
- K4 Integration into the story branch is serialized per story; a non-clean rebase yields `conflict` and routes via the workflow.

## 15. Human interface and observability

**Commands (v1)**

| Area | Commands |
|---|---|
| Setup | `init`, `uninstall`, `doctor` (M4) |
| Remote | `sync` |
| Heartbeat | `tick`, `watch` |
| Agent protocol | `brief`, `done`, `ask`, `stuck`, `hook` |
| Human | `inbox`, `answer`, `approve [--reject]`, `unstick [--to <step>]`, `mode` |
| Team | `take`, `release` |
| Views | `status`, `trace <slice>`, `why <slice>` |
| Housekeeping | `tidy` |

- O1 `norn inbox` (and a Herdr status pane) groups by action: **Answer**, **Approve**, **Unblock**, **Running**, **Recently done**; each item shows question/reason, age and the exact command to resolve it.
- O2 `answer`, `approve`, `unstick` write receipts; the next tick delivers them into the same session or a fresh one from the handoff. Typing directly into an agent pane is also allowed.
- O3 Notifiers are optional plugins (OS default; ntfy, webhook) and fire once per new inbox item, receipt-first.
- O4 Trace: one JSONL record per tick with facts snapshot, rule fired, action, result, briefing and transcript pointers.
- O5 `norn why <slice>` replays the pure decide function on the recorded snapshot and shows the rule that fired.
- O6 `handoff.md` journal: tool writes heartbeat lines (repeats collapsed, e.g. "(×3)"); agents write milestones.

## 16. Skills

Eleven single-job skills, written fresh (ideas from ai-engine ported, files not copied). One skill = one job = one kind of step. Outcomes are declared only in workflows.

| Skill | Job | Typical outcomes |
|---|---|---|
| `norn` | One-step protocol: brief, work in scope, keep handoff, report once, end turn, follow refusals. Only skill aware of norn. | — |
| `interview` | One question per turn until shared understanding. | done |
| `refine` | Story → spec with numbered Behaviour items, edge checklist, out of scope, open questions. | done |
| `clarify` | Settle open questions, fold answers into spec. | done |
| `plan` | Seams, coverage table (Behaviour → seam), prefactoring, decisions. Reference: codebase-design. | done |
| `slice` | Plan → slice files (`kind`, `depends_on`, acceptance citing Behaviour numbers, check commands, verifier). | done |
| `implement` | Test-first build of one slice. Reference: TDD, tests, mocking. | done |
| `fix` | Review findings or QA repro → red test → green. | done |
| `review` | Spec and Standards axes separately; smells list. | approve / changes_requested |
| `qa` | Check each acceptance criterion as a user, with evidence; never pass what wasn't checked. | pass / fail / needs_human |
| `merge` | Resolve conflicts by intent of both sides; stop if new behaviour is needed. | done |

- SK1 `norn init` installs skills into each configured agent's skill location with norn-owned markers; repo-local overrides win.
- SK2 The `norn` skill must stay under ~80 lines; it never contains workflow logic or state names.

## 17. Architecture and packaging

TypeScript on **Bun**, monorepo with one-way dependencies: `schema ← core ← store ← adapters ← cli`, plus `view`.

| Package | Contents |
|---|---|
| `@norn/schema` | JSON Schemas + generated types: workflow, frontmatter, `state.json`, receipts, trace events, claim blob. |
| `@norn/core` | Pure: workflow validation, decide/reconcile, briefing renderer, outcome classification, adapter interfaces. No IO. |
| `@norn/store` | `.agents/` files, `runs/` JSON, claim refs; atomic writes, validated reads. |
| `@norn/adapter-*` | `git`, `gh`, `glab`, `herdr`, `headless`, `claude`, `codex`, `opencode`, `gemini`, `notify-*`. |
| `@norn/view` | Read model `loadProjectView()` → stories, slices, inbox, runs, timeline. |
| `@norn/cli` | Wiring and commands. |

- X1 Front ends (web cockpit, Herdr pane, TUI) read only via `@norn/view` and write only via CLI verbs.
- X2 Adapters are selected in config by package name; third-party adapters implement interfaces from `@norn/core`.
- X3 Distribution: npm package plus `bun build --compile` single-file binaries. Agent plugins (Claude Code first) are thin wrappers bundling skills and a `/norn` command; no logic in plugins.
- X4 Core is tested by replaying recorded traces as snapshots; adapters against recorded fixtures.

## 18. Milestones

| Milestone | Scope | Proves |
|---|---|---|
| **M1 Manual core** (solo, GitHub, Claude) | `init` (config, workflow templates, skills, Claude hooks), `sync`, specs/slices/`runs/` store, workflow validation, `brief`/`done`/`ask`/`stuck`, `tick`/`watch`, `check`/`git`/`slices`/`gate` steps, `status`/`inbox`/`trace`/`why` | Deterministic flow, visible state, file-based handoff |
| **M2 Auto** | Herdr + headless runners, `silent`/`died`/`timeout`/`stalled` classification, bounded nudges, caps + queue, port slots, worktree lifecycle, OS notifier | Unattended reliability |
| **M3 Team** | Story claim refs (CAS), beat lease, `take`/`release`, takeover from handoff | A colleague can continue |
| **M4 Breadth** | `glab`, Codex/OpenCode/Gemini adapters, `doctor` | Agent- and remote-agnostic |

M2–M4 are developed as stories run by norn itself.

## 19. Success criteria

1. 100% of agent runs end in a classified outcome; zero "unknown" in the trace.
2. No step executes twice for the same attempt; no counter is exceeded; zero state transitions made by agents.
3. A scripted test continues a parked slice on another machine from git alone (`take` + `brief`); at least one real handoff during M3 dogfooding.
4. `norn why` explains every action; every human-needed item appears in the inbox within one tick.
5. `tick`, `brief`, `status`, `inbox` < 1 s on local state.
6. M2–M4 dogfooded through norn with < X% of steps needing manual intervention (X set after M2).

## 20. Deferred and open

| Item | Status | Note |
|---|---|---|
| Planning as a gated step by default | Deferred | Templates can include it; default policy to be decided. |
| Write-back to GitHub/GitLab (draft PR timing, status comment edited in place, `norn:stuck` label) | Deferred | v1 writes only pushes. |
| Agent permission profiles per step (`read`/`write`/`full`) translated per agent | Deferred | v1: permission prompts surface as `ask` in the inbox with the command shown. |
| Hard-deny `PreToolUse` hook (push, `gh`/`glab` writes, edits to `runs/`) | Deferred | Rule is stated in the `norn` skill meanwhile. |
| `norn retro` | Deferred | Mines the trace and proposes allow-list, limit, briefing and workflow changes as diffs for human approval; can itself be a workflow with a `gate`. |
| `fork/join` steps | Out of v1 | |
| Web cockpit | Later | Built on `@norn/view` + CLI verbs. |
| Additional skills (triage, human QA, resolve) | Later | |

## 21. Risks

| Risk | Mitigation |
|---|---|
| Agents forget to report | Hooks block turn end without receipt where possible; `silent` classification + bounded nudge + transcript snapshot. |
| Hook APIs differ or change across agents | Adapter per agent, fixture tests, `doctor`; tiered support for agents without hooks. |
| Herdr state is misleading (prior: `done` fired 3× while running) | Herdr is one fact among several; receipts win (C2). |
| Claim ref push races / offline machines | CAS via `--force-with-lease`; lease expiry; explicit `take --force` journaled. |
| Committed `runs/` noise in PR diff | Small JSON, one directory per slice; can be filtered in review tooling. |
| Prompt rules ignored by models | Limits enforced in code; `norn` skill kept tiny. |
| Workflow complexity creep | Small step-type set, load-time validation, fixed glossary. |

## 22. Prior art

- **ai-engine (norn v0.11.0):** kept — outcomes not states, refusals with `do_instead`, flows as validated data with reachability, claims as git refs with CAS, craft skills unaware of norn. Not repeated — LLM orchestrator (`norn-drive`/`norn-deliver`), labels/comments as store, liveness by claim age, prose output, global fix-round cap, slow `next` (11–18 s).
- **limen:** separate facts (turn end ≠ idle ≠ finished), explicit finish with handoff, idle snapshot of last message, receipts before send, hard limits in code, admission control. Not repeated — LLM coordinator as loop driver.
- **cezar:** native agent event streams normalised per adapter with fixture tests, named bounded continuation counters, handoff file (Goal/Progress/Resume), YAML workflow graph with `check` and loop counters, restart is never an answer. Not repeated — fragile text markers as the primary signal, long-lived stateful server.
