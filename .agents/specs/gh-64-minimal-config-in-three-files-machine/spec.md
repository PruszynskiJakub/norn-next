---
id: gh-64
slug: minimal-config-in-three-files-machine
provider: gh
number: 64
url: https://github.com/PruszynskiJakub/norn-next/issues/64
title: "Minimal config in three files: machine, you in this repo (config.local.yaml), the team"
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:refinement
workflow: quick
status: active
intake_at: 2026-11-02T07:08:29.386Z
body_hash: 370f9e0ab73a2c566c1d86a8df111f353b89a83c1c1f1f5ff728d896fa778abe
---

# Minimal config in three files: machine, you in this repo (config.local.yaml), the team

## Problem

A person setting norn up meets 38 settable keys in two files that take the same schema: the user file `~/.norn/config.yaml` and the committed team file `.agents/norn.config.yaml`. To predict what is in effect they need about nine merge rules: the team file wins, except machine caps take the lower value; an `agents` entry replaces the built-in one whole; `notifiers` replaces as a list; `null` unsets. Most keys change nothing anyone needs to change, and several are never read at all. The person cannot tell which keys matter.

What this costs them today (reproduced with the CLI):

- **Contradictions pass every check.** `claim: {lease: 1m, renew: 5m}` lets another machine take a story mid-work; `slots: {min: 5, max: 2}` makes every lease fail; `default_agent: codex` with no `agents.codex` fails only at launch. `norn config`, `doctor` and `status` accept all three.
- **Typos go unseen.** Adapter `options` are untyped: `runner: {adapter: herdr, options: {reuse_worskpace: true}}` is ignored without a word. `notifiers: [{adapter: ntfy}]` passes validation, then `norn doctor` stops at `notifier ntfy: set option topic (or url)`, naming no file and running no other check.
- **Setting a model drops the permission mode.** Writing `agents: {claude: {model: …}}` replaces the built-in entry and loses `--permission-mode auto`, so unattended Claude sessions park on permission prompts.
- **Adding ntfy drops OS notifications**, because `notifiers` is a list that replaces the built-in one.
- **Errors blame the wrong file and the wrong thing.** Adapter errors always say to fix the team file, even for a value from the user file. A config typo is reported as "Corrupt state (corrupt)".
- **There is no personal file for one repo.** Running one repo in auto mode, or with another model, means committing that choice for the whole team.
- **No starting point.** `norn init` never writes the user file, and the schema the template points editors at exists only in norn's own repo.
- **Auto mode silently needs a runner.** With `default_mode: auto` and no `runner` configured, every story runs manual.

## Solution

Configuration shrinks to the keys a person actually needs, each legal in exactly one kind of file, and every key optional. A solo developer on GitHub with Claude Code writes nothing.

| File | For | Keys |
|---|---|---|
| `~/.norn/config.yaml` | this machine, and your defaults for every repo | machine: `max_agents`, `notify`, `trace.retain` · yours: `mode`, `agent`, `agents.<name>` (`model`, `args`) |
| `.agents/norn.config.local.yaml` (new, gitignored) | you, in this repo | `mode`, `agent`, `agents.<name>` (`model`, `args`): these override the user file |
| `.agents/norn.config.yaml` (committed) | the team | `provider`, `base_branch`, `workflow`, `slice_workflow` |
| a workflow file | the workflow | top-level `mode`; `defaults:` with `deadline`, `nudges`, `retries`, `stalled` (steps keep their own three: `deadline`, `nudges`, `retries`) |

The rules a person must know:

1. Machine keys live only in the user file; team keys only in the team file. A key in the wrong file is refused, and the error names the right file.
2. For your keys, the nearer file wins: this repo's local file over the user file over the built-in value.
3. A story's mode comes from, nearest first: the story (`norn story edit --auto|--manual`), the workflow, the local file, the user file, built-in `manual`.
4. Maps merge key by key; lists and scalars replace. An agent entry merges field by field over the built-in one, and `notify` is a map, so adding ntfy keeps OS notifications.
5. Everything else has no key: norn detects it, derives it or fixes it, and `norn config` shows it with the source `built-in` or `derived`.

Old configs are refused with a message naming each moved key and its replacement; `norn migrate` rewrites them. Criteria lose `needs`, together with agent `capabilities`.

## Behaviour

### Files and where keys belong

- B1 As a solo developer on GitHub with Claude Code, I want norn to work with no config file written, so that setup is `norn init` and nothing else.
  Example: a fresh repo after `norn init`, no user config edits → `norn config` lists every setting with source `built-in` or `derived` (provider `gh` derived from the remote URL, runner derived, agent `claude` built-in), and a tick runs the `triage` workflow on a labelled issue.
- B2 As a person, I want `~/.norn/config.yaml` to take exactly the machine keys (`max_agents`, `notify`, `trace.retain`) and my keys (`mode`, `agent`, `agents.<name>`), so that one file holds this machine and my defaults for every repo.
  Example: `max_agents: 4`, `mode: auto`, `agents: {claude: {model: claude-opus-5-5}}` in the user file → `norn config` shows each with source `user`.
- B3 As a person, I want `.agents/norn.config.local.yaml` to take `mode`, `agent` and `agents.<name>` and override the user file for this repo only, so that I can run one repo differently without committing it for the team.
  Example: user file `mode: manual`, this repo's local file `mode: auto` → `norn config` in this repo shows `mode auto (local)`; in another repo, `mode manual (user)`.
- B4 As a team, I want `.agents/norn.config.yaml` to take exactly `provider`, `base_branch`, `workflow` and `slice_workflow`, so that the committed file holds only what the team agrees on.
  Example: `base_branch: develop` in the team file → `norn config` shows `base_branch develop (repo)`, and new story branches are cut from `develop`.
- B5 As a person who puts a key in the wrong file, I want it refused with `config_wrong_file` naming the file that takes it, so that I can move it.
  Example: `max_agents: 4` in `.agents/norn.config.yaml` → "Config error: `.agents/norn.config.yaml`: `max_agents` belongs in `~/.norn/config.yaml` (machine key)"; `provider: glab` in the user file → names `.agents/norn.config.yaml`; `max_agents` in the local file → names `~/.norn/config.yaml`.
- B6 As a person who mistypes a key or a value, I want `config_invalid` naming the file, the key path and what is wrong, so that I can fix it without guessing.
  Example: `max_agent: 4` in the user file → "Config error: `~/.norn/config.yaml`: unknown key `max_agent`"; `mode: automatic` → "`mode` must be manual or auto".
- B7 As a person, I want every config error shown under the title "Config error" with its own exit code, never as corrupt state, so that I know a file I wrote needs fixing and no unit is broken.
  Example: any command that loads config with a typo in the local file → the "Config error" title, the config exit code; `--json` prints a `CliError` with code `config_invalid`. No unit is marked `corrupt`.
- B8 As a person, I want an empty or missing file to count as setting nothing, so that deleting a file returns to the built-in values.
  Example: an empty `.agents/norn.config.local.yaml` → `norn config` shows the user or built-in values, with no error.
- B9 As a person, I want `norn init` to add `.agents/norn.config.local.yaml` to `.gitignore`, so that my personal file is never committed by accident.
  Example: `norn init` in a repo → `.gitignore` gains `.agents/norn.config.local.yaml` beside `.env.norn` and `.norn-unit`; a second `norn init` adds nothing.

### Your keys: mode, agent, agents

- B10 As a person, I want a story's mode taken from, nearest first, the story, the workflow, the local file, the user file and built-in `manual`, so that a team decision in a workflow beats my personal default and my explicit choice on a story beats both.
  Example: user `mode: auto`, workflow `release` with `mode: manual` → a `release` story runs manual; the same story after `norn story edit gh-9 --auto` → auto; a `triage` story with no workflow `mode` → auto (user).
- B11 As a person, I want `mode` set only at workflow level, never on a step, so that a story's mode is one value per workflow.
  Example: a step with `mode: auto` → the workflow is refused at load (W5) with the step named: "`mode` is set on the workflow, not on a step".
- B12 As a person, I want `mode: auto` to start agents with whatever runner norn detects, so that auto mode never silently becomes manual for lack of a runner key.
  Example: `mode: auto`, Herdr not installed → the tick starts unattended steps headless; `status` shows no "no runner; running manual" downgrade.
- B13 As a person, I want `agent` to pick the coding agent for every step that names none, with built-in names usable without an entry, so that switching agents is one line.
  Example: `agent: codex` in the user file and no `agents` entry → agent steps without `agent:` start Codex.
- B14 As a person, I want `agents.<name>` to take only `model` and `args`, merged field by field over the built-in entry, so that setting a model keeps the built-in flags.
  Example: `agents: {claude: {model: claude-opus-5-5}}` → Claude starts with `--permission-mode auto` and that model; `norn config` shows `agents.claude.args` from `built-in` and `agents.claude.model` from `user`.
- B15 As a person, I want `args` to replace the built-in list whole, so that I can remove a built-in flag.
  Example: `agents: {claude: {args: []}}` → Claude starts with no extra flags, in its own default permission mode.
- B16 As a person, I want the local file's agent entry to merge over the user file's, field by field, so that one repo can change the model and keep my other settings.
  Example: user `agents.claude.args: ["--permission-mode", "plan"]`, local `agents.claude.model: claude-sonnet-5-5` → in this repo Claude starts with `plan` mode and Sonnet.
- B17 As a person who names an agent norn does not ship, I want `config_invalid`, so that a typo is found before a launch.
  Example: `agent: claud` → "`agent` must be one of claude, codex, opencode, gemini"; `agents: {aider: {}}` → "unknown agent `aider`". Checked after the files are merged.

### Machine keys

- B18 As a person, I want `max_agents` (default 9) to cap the agent sessions running at once on this machine across every repo, and check commands to follow the same cap, so that I can lower it if my machine struggles.
  Rationale for 9: every session needs a slot for its ports and there are 9 slots, so 9 is already the real ceiling; a default equal to it removes a hidden throttle.
  Example: no `max_agents` → up to 9 sessions start; `max_agents: 2` with two running → the third waits with "queued: max_agents 2 in use", and so does a third check command.
- B53 As a person who sets `max_agents` above 9 or below 1, I want `config_invalid`, so that no value promises sessions that can never start.
  Example: `max_agents: 12` → "Config error: `~/.norn/config.yaml`: `max_agents` must be 1–9 (there are 9 slots)".
- B19 As a person, I want `notify` to be a map `{os, ntfy, webhook}` where `os` is on by default and `ntfy` and `webhook` take a URL, so that adding a channel keeps the others.
  Example: `notify: {ntfy: https://ntfy.sh/my-norn}` → a new inbox item fires an OS notification and an ntfy push; `notify: {os: false}` → no OS notification; `notify: {webhook: not-a-url}` → `config_invalid` naming `notify.webhook`.
- B20 As a person working inside Herdr, I want the Herdr notifier on by itself, so that I need no key for it.
  Example: norn running in a Herdr session with no `notify` key → new inbox items notify through Herdr and the OS.
- B21 As a person, I want `trace.retain` (default 14d, at least 14d) in the user file only, so that I decide how much local history `norn tidy` keeps on my disk.
  Example: `trace: {retain: 30d}` in the user file → `norn tidy` keeps 30 days of trace; `trace.retain` in the team file → `config_wrong_file` naming the user file; `retain: 7d` → `norn tidy` refuses and `norn doctor` warns, as today.

### Team keys

- B22 As a team on GitHub or GitLab, I want `provider` detected from the remote URL when unset, so that only a self-hosted host needs it written.
  Example: remote `git@gitlab.com:acme/app.git` and no `provider` → `norn config` shows `provider glab (derived: remote URL)`; `provider: gh` in the team file → `gh (repo)`.
- B54 As a team on a self-hosted host, I want norn to refuse when `provider` is unset and the remote URL names neither GitHub nor GitLab, so that a wrong guess never makes every sync fail with a confusing error.
  Example: remote `git@git.acme.internal:app.git`, no `provider` → "Config error: can't tell the provider from `git.acme.internal`: set `provider` in `.agents/norn.config.yaml`". A repo with no remote keeps today's behaviour (`gh`, nothing synced).
- B23 As a team, I want `base_branch` to default to the remote's default branch, so that only a repo integrating elsewhere sets it (BS0, unchanged).
  Example: remote default `main`, no key → stories cut from and PR'd into `main`.
- B24 As a team, I want `workflow` (default `triage`) and `slice_workflow` (default `slice`) to name the workflow a new story or slice starts in, with an issue's `norn:wf:<name>` label still winning, so that a team can change the entry point in one line.
  Example: `workflow: story` → an issue without a `norn:wf:` label is taken in on `story`; one labelled `norn:wf:reproduce` on `reproduce`.

### Workflow keys

- B25 As a workflow author, I want a top-level `mode: manual | auto` in a workflow file, so that the team decides how a kind of work runs.
  Example: `release.yaml` with `mode: manual` → every `release` story runs manual unless a person sets the story with `norn story edit`.
- B26 As a workflow author, I want a `defaults:` block with `deadline`, `nudges`, `retries` and `stalled` that applies to every step not setting its own, so that a workflow states its limits once.
  Example: `defaults: {deadline: 30m}` and a step with `deadline: 90m` → that step times out after 90 minutes, every other after 30; a workflow without `defaults:` → 60m, 2, 1, 15m.
- B27 As a person, I want the attended wait fixed at 2 minutes, so that there is no key for it.
  Example: an attended run waiting for its person for 2 minutes → it shows under Your turn (HC2).
- B28 As a person, I want the tick's hook-read window to cover the longest `stalled` across the loaded workflows, so that a workflow with a longer `stalled` is judged on enough activity.
  Example: one workflow `defaults: {stalled: 40m}` → a step in it with 30 minutes of quiet is not stalled.

### No key: detected, derived or fixed

- B29 As a person, I want the runner detected (Herdr when running inside Herdr or when it is installed, otherwise headless), so that I configure nothing to get auto mode.
  Example: Herdr installed → `norn config` shows `runner herdr (derived: herdr on PATH)`; not installed → `runner headless (derived)`.
- B30 As a person, I want the issue label fixed at `norn`, so that there is no label key.
  Example: an issue labelled `norn` and assigned to me → taken in; `remote.label` in a file → `config_moved` (B36).
- B31 As a person, I want the git remote derived (the remote the base branch tracks, else `origin`), so that a fork setup needs no key.
  Example: base branch `main` tracks `upstream/main` → fetches, base ref and the claim use `upstream`; `norn config` shows `git remote upstream (derived)`.
- B32 As a person, I want the remote sync fixed at about every 5 minutes, with `norn sync` forcing one, so that there is no sync key (GR1).
  Example: a new labelled issue → taken in within about 5 minutes of `norn watch`, or at once after `norn sync`.
- B33 As a person, I want slots fixed at 1–9 with 10 ports each, slot `n` starting at port `4000 + 10·n`, and `.env.norn` holding only `NORN_SLOT` and `PORT_BASE`, so that there are no slot keys.
  Example: a unit in slot 2 → `.env.norn` has `NORN_SLOT=2`, `PORT_BASE=4020`; the check frees ports 4020–4029 (K4.1).
- B34 As a person, I want the tick interval set by `norn watch --interval` and a new `norn tick --interval` (default 30s), recorded in the checkout's heartbeat, so that liveness checks agree with how the tick is run, cron included.
  Example: cron runs `norn tick --interval 2m` → no "no heartbeat" Unblock item while ticks arrive every 2 minutes; `norn watch` with no flag → 30s recorded.
- B35 As a person, I want claim timing derived from the recorded interval (lease = the larger of 10 minutes and 4 × interval; renewed every third of the lease), so that a claim can never expire between renewals.
  Example: interval 30s → lease 10m, renewed every 3m20s; interval 5m → lease 20m, renewed every 6m40s; `norn config` shows both as `derived`.

### Criteria lose `needs`

- B36 As a person writing slices, I want criteria to carry only `id` and `verifier`, with agent `capabilities` gone, so that no field promises a check norn does not need.
  Example: a slice criterion `{id: c1, verifier: agent}` → valid; the brief lists it without a needs column; `norn done` accepts a `pass` on it from any agent.
- B37 As a person, I want the `norn-slice` skill to stop writing `needs`, and QA counts to stop splitting `unverified` by capability, so that nothing produces or reports the removed field.
  Example: a new slice written by the skill → no `needs` in its criteria; `norn run list <unit>` shows `unverified` counts with no per-capability breakdown.
- B38 As a person with a slice file that still has `needs`, I want it refused with a message pointing at `norn migrate`, never marked corrupt, so that I know how to fix it.
  Example: a slice with `needs: [browser]` → "slice `gh-12/02`: `needs` was removed; run `norn migrate`"; the unit is not `corrupt`.

### Old configs

- B39 As a person upgrading, I want any old or moved key refused with `config_moved`, naming the file, the key, its replacement and `norn migrate`, so that nothing is guessed (S2).
  Example: `default_agent: codex` in the user file → "Config error: `~/.norn/config.yaml`: `default_agent` is now `agent`; run `norn migrate`"; `remote.label` → "`remote.label` is gone: the label is always `norn`"; `runner:` → "`runner` is gone: norn detects it". Covers `default_agent`, `default_mode`, `default_workflow`, `default_slice_workflow`, `remote.*`, `runner`, `notifiers`, `max_checks`, `slots`, `watch_interval`, `claim`, `limits`, `agents.<name>.adapter`, `command`, `env` and `capabilities`.
- B40 As a person, I want `norn migrate` to rewrite `~/.norn/config.yaml` in place, and to rewrite `.agents/norn.config.yaml` and stage it, so that upgrading is one command plus a commit.
  Example: user file with `default_mode: auto` and `notifiers: [{adapter: os}, {adapter: ntfy, options: {url: https://ntfy.sh/x}}]` → becomes `mode: auto` and `notify: {ntfy: https://ntfy.sh/x}`; the team file's `remote: {provider: gh}` becomes `provider: gh`, staged.
- B41 As a team, I want `norn migrate` to move team `limits` into the `defaults:` of each workflow in `.agents/workflows/`, staged, so that the team's limits keep applying.
  Example: team `limits: {deadline: 45m}` → every workflow gains `defaults: {deadline: 45m}`; the team file loses `limits`. A workflow that already sets a limit under `defaults:` keeps its own value; migrate fills only the limits it does not set.
- B42 As a team, I want `norn migrate` to move a team `default_mode` into the top-level `mode` of each workflow that does not set one, staged, so that the team's choice stays a team choice.
  Example: team `default_mode: auto`, `release.yaml` with `mode: manual` → every workflow but `release` gains `mode: auto`; `release` keeps `manual`.
- B43 As a team, I want `norn migrate` to drop from the team file every key that now belongs only in a personal file (`default_agent`, `agents`, machine keys) and every removed key, and list each one with its value, so that nobody's machine changes without them knowing.
  Example: team `max_agents: 1` and `default_agent: codex` → both removed; the report says "removed `max_agents: 1` from the team file: set it in `~/.norn/config.yaml` if you want it" and the same for `agent: codex`.
- B44 As a person, I want `norn migrate` to strip `needs` from every slice file under `.agents/specs/` and stage them, so that old slices load again.
  Example: two slices with `needs` → both rewritten without it, staged, and listed.
- B45 As a person, I want `norn migrate` to change nothing when run again, to never commit or push, and to refuse before changing anything when a precondition fails, as it does for the layout move, so that it is safe to retry.
  Example: `norn migrate` twice → the second run reports nothing to change; run from a unit worktree → refused, nothing written.

### Showing and checking config

- B46 As a person, I want `norn config` to show every setting, with or without a key, with its value and source (`built-in`, `derived` with the reason, `user`, `local`, `repo`), so that I can see what is in effect and why.
  Example: `norn config` → `mode auto (local)`, `runner headless (derived: herdr not on PATH)`, `claim lease 10m (derived: interval 30s)`, `label norn (built-in)`.
- B47 As a person, I want an adapter error to name the file the bad value came from, so that I fix the right file.
  Example: an unreachable ntfy URL set in the user file → the error says to fix `~/.norn/config.yaml`, not the team file.
- B48 As a person running `norn doctor`, I want an adapter that fails to build reported as one `FAIL config` line while the other checks still run, so that one bad value does not hide the rest.
  Example: a bad `notify.webhook` → `FAIL config: notify webhook: …` followed by the remaining doctor lines.

### Init starters and editor schema

- B49 As a new user, I want `norn init` to write a commented `~/.norn/config.yaml` when none exists, never overwriting one, so that I see every key I may set with its default.
  Example: first `norn init` on a machine → the user file lists `max_agents`, `notify`, `trace`, `mode`, `agent`, `agents` commented out with defaults; a second `norn init` leaves it alone.
- B50 As a person editing a config file, I want a JSON schema copy next to each file and a `# yaml-language-server: $schema=` modeline in the starter files, so that my editor completes and validates keys offline.
  Example: opening `.agents/norn.config.yaml` in an editor with YAML language support → `max_agents` is flagged as not allowed in this file; `base_branch` completes.
- B55 As a team, I want the team file's schema committed next to it as `.agents/norn.config.schema.json`, refreshed by `norn init` and `norn migrate`, so that every teammate's editor validates it without running init.
  Example: a teammate clones the repo and opens the team file → the editor validates it; after upgrading norn, `norn migrate` updates the schema copy, staged.

### Existing units and docs

- B51 As a person with stories in flight, I want a running unit to keep its pinned workflow, which takes the new built-in limits and mode rules when it has no `defaults:` or `mode:`, so that the upgrade does not restart work.
  Example: a unit pinned to a workflow from before the change → after upgrade and `norn migrate`, it continues at its step with deadline 60m unless its steps set their own.
- B52 As a reader of the docs, I want help, README, the cookbook, the init config template and the AGENTS.md decisions to describe only the new keys and files, so that no doc names a removed key.
  Example: `norn help config` and the README config section list the four files and the keys above; the repo lint finds no `default_mode`, `notifiers` or `limits.` in docs.

## Out of scope

- A `mode` on a step — decided against for now; mode is per workflow.
- Third-party agent and runner packages (X2) — `adapter` and `runner` keys are removed; built-in agents and runners only. `webhook` stays the way out to external tools.
- A key to force headless inside Herdr — no one needs it yet; can return without breaking anyone.
- Per-slot extra resources (`slots.env`) — an app builds its own names from `NORN_SLOT` and `PORT_BASE`.
- A separate cap for check commands — checks follow `max_agents`.
- Agent `command` and `env` — the agent runs by its usual name from PATH.
- Automatic rewrite of config on load — `norn migrate` is the one place that writes.

## Open questions

None.

## Plan

### Seams

- **S1 The CLI, through the cli harness (`runCli` with the fake clock, `FakeRemote`, `FakeRunner`, an injected `env` and a temp `NORN_HOME_DIR`).** Observes what a person sees from a command: `norn config list|get --json` values and sources, refusals (title, exit code, `CliError` code), files `init` and `migrate` write or stage, what a `tick` launches and queues, the brief, `done`, `run list`, `doctor` lines. Observes B1–B10, B13–B17, B21–B25, B29–B34, B36–B50, B53–B55.
  Prior art: the cli integration tests for `norn config` (list/get/set), `norn migrate`, criteria, story-start and runtime; `test/support/harness.ts`.
- **S2 Core decide and the inbox, through `decide(facts, workflows, config)` and `buildInbox`.** Observes the timing and counting rules that need many minutes of fake time or many running units: limits from a workflow's `defaults:`, the fixed attended wait, the `max_agents` cap on sessions and checks, claim renewal on the derived period, an old pinned workflow taking the built-in limits. Observes B18, B26, B27, B35, B51.
  Prior art: core unit tests of decide (`decide`, `attended-wait`, `apply`), `rule-cases.ts` and the golden corpus.
- **S3 Port wiring, through `buildPorts(registry, adapterContext, config)` with a recording registry and an injected `env`.** Observes which runner and which notifiers a resolved config builds, which the harness cannot see because it injects both ports. Observes B12, B19, B20.
  Prior art: none for `buildPorts` directly; the notify adapter unit tests show the option shapes.
- **S4 Workflow load, through store `loadWorkflows` and core workflow validation (W5).** Observes B11's refusal and that `mode` and `defaults:` load. Observes B28 (the hook read window is computed from the loaded workflows).
  Prior art: core and schema workflow unit tests.
- **S5 The repo lint, `test/repo/repo.test.ts`.** Observes B52: no doc, help text, template or bundled skill names a removed key.
  Prior art: its banned-words lint.

### Coverage

| Behaviour | Seam | Test kind | Notes |
|---|---|---|---|
| B1 | S1 | integration | fresh repo, `init`, no config: `config` sources built-in/derived; a tick takes a labelled issue on `triage` |
| B2 | S1 | integration | |
| B3 | S1 | integration | two repos, one user home |
| B4 | S1 | integration | |
| B5 | S1 | integration | one case per file |
| B6 | S1 | integration | |
| B7 | S1 | integration | exit code and title; no unit marked corrupt |
| B8 | S1 | integration | |
| B9 | S1 | integration | `init` twice |
| B10 | S1 | integration | tick launches or holds; `story edit --auto` overrides the workflow |
| B11 | S4 | unit | |
| B12 | S3 | unit | no runner key, no Herdr → headless built |
| B13 | S1 | integration | the launched session's agent in `FakeRunner` |
| B14 | S1 | integration | resolved `agents.claude` with per-field sources |
| B15 | S1 | integration | |
| B16 | S1 | integration | |
| B17 | S1 | integration | |
| B18 | S2 | unit | sessions and checks queued at the cap |
| B19 | S3 | unit | |
| B20 | S3 | unit | `HERDR_ENV` in the injected env |
| B21 | S1 | integration | wrong file; tidy and doctor behaviour unchanged |
| B22 | S1 | integration | remote URL set in the harness clone |
| B23 | S1 | integration | existing BS0 tests keep passing |
| B24 | S1 | integration | intake with and without a `norn:wf:` label |
| B25 | S1 | integration | |
| B26 | S2 | unit | |
| B27 | S2 | unit | |
| B28 | S4 | unit | window = longest `stalled` |
| B29 | S1 | integration | fake `herdr` on the injected PATH |
| B30 | S1 | integration | `remote.label` → `config_moved` |
| B31 | S1 | integration | clone with `upstream` tracking |
| B32 | S1 | integration | sync due after 5m, forced by `norn sync` (existing tests) |
| B33 | S1 | integration | `.env.norn` content |
| B34 | S1 | integration | `tick --interval 2m` then `status`: no "no heartbeat" item |
| B35 | S2 | unit | renew period; `config` shows `derived` under S1 |
| B36 | S1 | integration | brief and `done` |
| B37 | S1 | integration | `run list` counts; the skill text by S5 |
| B38 | S1 | integration | tick and brief on a slice with `needs` |
| B39 | S1 | integration | one case per moved key family |
| B40 | S1 | integration | |
| B41 | S1 | integration | |
| B42 | S1 | integration | |
| B43 | S1 | integration | |
| B44 | S1 | integration | |
| B45 | S1 | integration | |
| B46 | S1 | integration | |
| B47 | S1 | integration | bad ntfy URL in the user file |
| B48 | S1 | integration | `doctor` |
| B49 | S1 | integration | |
| B50 | S1 | integration | modelines and schema copies written; the copies validate sample files with ajv |
| B51 | S2 | unit | pinned workflow without `defaults:` |
| B52 | S5 | unit | |
| B53 | S1 | integration | |
| B54 | S1 | integration | |
| B55 | S1 | integration | |

### Prefactoring

1. **Effective settings speak the new names.** Rename the fields of the resolved config every reader uses to the new keys (`agent`, `mode`, `workflow`, `slice_workflow`, `provider`, …) while the files still take the old ones, mapped in the layer merge; convert the golden corpus's `config` once with a script. No behaviour changes. Buys: every later slice and `norn config` speak one vocabulary; no old name spreads (B2–B4, B46).
2. **One function for a story's mode.** Replace the five places that compute `state.mode ?? default_mode` (agent unit, observe, view, `story edit`, doctor) with one core function. Buys: B10 and B25 change one place.
3. **One function for a step's limits.** Replace every read of the global limits (decide, apply, brief, observe, inbox) with one core function of the workflow and the step. Buys: B26–B28 and B51 change one place.

### Implementation decisions

- D1 **Files and settings are two types.** The config files stay YAML. Three file schemas (user, local, repo), each emitted as a JSON schema (the format editors read through the modeline, B50, B55); the resolved config stays the one value decide, views and commands read, built by a pure resolver from the three files plus a `derived` input (runner detected, remote URL, tracking remote, recorded tick interval) that the cli context gathers before resolving. Limits and the attended wait leave the resolved config (workflow `defaults:` and a constant); slots become constants; claim lease and renew stay as fields, derived.
- D2 **Error order per file: moved, then wrong file, then invalid.** A table of moved and removed keys with their replacement is checked first, so an old key is `config_moved` rather than an unknown key; a key another file takes is `config_wrong_file`; anything else failing the file's schema is `config_invalid`. Cross-file checks (`agent` names a built-in agent, `max_agents` 1–9) run after the merge and name the file that set the value.
- D3 **A new exit code `config` (6) with the title "Config error".** Loading config throws it in place of today's `corrupt`, with `CliError.code` `config_invalid`, `config_wrong_file` or `config_moved` and the file path in `details`.
- D4 **`norn config set|unset` gains `--local`** and checks the key against the target file's schema, refusing a key that belongs elsewhere with `config_wrong_file`. The seeding of a new `agents.<name>` entry from the layer below goes, since entries now merge field by field.
- D5 **The heartbeat records the tick interval.** `heartbeat.json` gains `interval` (absent → 30s). `norn watch` always writes its interval (`--interval`, default 30s); `norn tick` writes it only when given `--interval`, so a tick run by hand never overwrites the interval cron recorded. Liveness (3 × interval) and claim timing read it.
- D6 **Runner detection:** inside Herdr means `HERDR_ENV=1` in the env; installed means `herdr` resolves on the env's PATH. Detected once per command in the cli context, from the injected env, so tests control it.
- D7 **Provider derivation:** the remote URL's host containing `github` → `gh`, `gitlab` → `glab`; a URL with any other host and no `provider` key → refused (B54). A remote that is a local path, or no remote, keeps `gh` (today's behaviour; the harness clones from a local path).
- D8 **Git remote derivation:** with `base_branch` set, the remote its local branch tracks; unset, the remote the branch checked out in the main checkout tracks (normally `main`); else `origin`. This settles B31's "base branch" when `base_branch` is unset, since the remote's default branch needs a remote first.
- D9 **`notify` builds the notifier list in wiring:** `os` unless `os: false`, `ntfy` and `webhook` from their URL (http or https, checked by the schema), `herdr` when inside Herdr. The ntfy adapter takes the one URL.
- D10 **Agent names are an enum of the four built-ins** for `agent` and the keys of `agents`; an entry takes only `model` and `args`, merged field by field over the built-in entry and then the user's, `args` replacing whole.
- D11 **`needs` and agent `capabilities` go:** criteria schema, QV5a's check in `done`, the brief's needs column, the capability split in QA counts, and the skill text. Runner capabilities (send, resume, open) are a different thing and stay.
- D12 **A slice that still has `needs`** fails its frontmatter load with its own reason (not corrupt): the unit shows under Unblock with "run `norn migrate`", and commands that load it refuse with exit `refused`, code `needs_removed`.
- D13 **`norn migrate` does the config rewrite after the layout move,** under the same preconditions (main checkout, tick lock), editing YAML as documents so comments stay. Mapping: `default_*` → new names; `notifiers` → `notify` (ntfy topic or server+topic → URL; unknown adapters dropped and listed); team `limits` → each workflow's `defaults:` (B41); team `default_mode` → each workflow's `mode` (B42); everything removed or now personal is dropped and listed with its value (B43); slice `needs` stripped (B44). The team file, the workflows, the slices and the schema copy are staged; the user file is rewritten in place.
- D14 **Schema copies:** the user schema at `~/.norn/config.schema.json` (written by `init`, refreshed by `init` and `migrate`); the team and local schemas committed beside their files in `.agents/` (B55); the starters carry a modeline to their copy.
- D15 **Adapter errors name their file:** wiring builds each agent and notifier from a config key and attaches that key's source file (from the explain entries) to the error; `doctor` catches each failure into one `FAIL config` line and runs the rest.
- D16 **`max_agents` defaults to 9, range 1–9, and checks keep their own count under the same cap** (two counts, one number), so sessions and checks queue separately as today.
- D17 **`stalled` is a workflow limit only.** It is set in `defaults:` (or built in, 15m), never on a step; steps keep `deadline`, `nudges`, `retries`. The hook read window is the longest `stalled` across the loaded workflows (B26, B28). The spec's file table was amended to say so.

### Testing decisions

- Tests drive the seams above only; none reaches into the resolver, the moved-key table or the YAML rewriting directly.
- Faked, at system boundaries only: the clock, the remote (`FakeRemote`), the runner (`FakeRunner`), the notifiers (`FakeNotifier`, a recording registry under S3), and the environment (PATH with a fake `herdr`, `HERDR_ENV`, `NORN_HOME_DIR`). Git and the file system are real.
- The harness pins an env without `HERDR_ENV` and with a PATH that has no `herdr`, so a developer machine with Herdr installed gives the same results as CI.
- The harness and every test that writes old keys move to the new files (mode in the user or local file, limits in workflows) in the step of the order (Risks) that removes the old key.

### Risks

The next round is `quick` (no slices), so this Plan is built in one implement pass, in this order: prefactors 1–3; the three file schemas, the resolver with derived values and the config errors (D1–D3, D6–D8, D10, D16); workflow `mode` and `defaults:` (D17); notify and wiring (D9, D15); heartbeat interval (D5); `needs` removal (D11, D12); `config set --local` (D4); `init` starters and schema copies (D14); `norn migrate` (D13); docs last (B52). The risks below say where in that order each risk is met.

- **Test churn.** About fifty test files and the 93 golden cases write or embed old keys. Prefactor 1 converts the corpus by script; each later step of the order moves only the tests of the keys it removes, and lands green before the next, so the one pass stays reviewable commit by commit.
- **Detection leaking from the host.** Runner detection reads PATH and `HERDR_ENV`; unpinned, tests would pass or fail by machine. The harness pins both in the first step that detects (the resolver step).
- **`norn migrate` rewriting YAML with comments.** The YAML document API keeps comments on edits but can reflow flow maps; the migrate step starts with tests of commented user and team files before the mapping grows.
- **Effect transcripts and observe snapshots.** Facts that carry mode or config, and the heartbeat's new field, may change them; rewrite them only in the step that changes that behaviour, and review the diff.
