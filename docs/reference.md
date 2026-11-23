# Reference

Every command and flag, every config key, the signals a workflow can route, the inputs an agent step can name, the workflows the bundled pack ships and the exit codes. The lists between the two marker comments below are generated from the CLI itself (`bun run docs:emit`), so they match the release this file ships with. What the terms mean is in [Concepts](concepts.md).

## Output and exit codes

Commands a person or an agent reads print markdown. Every command prints one JSON value instead with `--json`; `norn hook` answers its harness in the harness's own format. Code should branch on the exit code and the `--json` data, never on the markdown.

A refusal prints `{error, do_instead, code}` (as markdown without `--json`): what was refused, what to do instead and a stable code. The exit code says why: `refused` (3) when a rule says no, `usage` (2) for bad arguments, `corrupt` (4) when a file norn keeps fails validation, `busy` (5) when another process holds the lock or the claim, `config` (6) when a config file is wrong. The full list is under [Exit codes](#exit-codes).

A command marked *a person's command* below is refused with `person_only` (exit 3) when it runs in an agent's session, that is when `NORN_UNIT` or `NORN_RUN_ID` is set, in its own env or in the env any process above it was started with, as every launch sets them for the agent and all it starts. Clearing them in the agent's shell (`env -u NORN_UNIT …`) does not lift the refusal; a process list norn cannot read refuses too. Its `do_instead` tells the agent to ask the person (`norn ask "…"`); the person runs it from their own shell, not from the agent's pane.

## Config

`norn init` writes the config from what it detects (the tracker, the forge, the executor and the runner; a flag overrides each choice) and runs `norn doctor`. Three files hold it, and every file takes every key:

| File | For |
|---|---|
| `<norn home>/config.yaml` | this machine, and your defaults for every repository (`~/.norn`, or `NORN_HOME_DIR`) |
| `.agents/norn.local.yaml` | you, in this repository: kept out of git, the file `norn init` writes |
| `.agents/norn.yaml` | the team: committed, written by `norn init --commit` |

The nearer file wins: the committed file over the local file over the user file over the built-in defaults, for every key but the policy ([Policy](#policy)). Maps merge key by key; lists and scalars replace. A key norn does not know is refused with the file it is in, never ignored; a slot (`tracker`, `forge`, `store`, `vcs`, an executor's `runner`, a `runners:` entry) also takes the keys of the plugin it names, and that plugin checks them. `norn config show` prints the merged config and the file each key came from; `norn config set <key> <value>` changes one key in the local file, or in the committed file with `--commit` or the user file with `--user`.

A slot names a plugin with `use`: the bundled ones are listed by `norn plugin list`, and `norn plugin add <spec>` installs another and pins it in the plugin lock. `norn plugin add` and `norn plugin update` are a person's commands: they name the effects the plugin's step kinds declare (`outward`, `cost`, `forge-write`), which the floor reads, and record them as accepted in `<norn home>/plugins/accepted/`. A plugin whose kinds later declare other effects is refused (`plugin_effects`) until the person runs `norn plugin update <name>`; one installed before acceptance existed loads while its kinds declare none. The effects of a kind over a slot (`forge.await-merge`, `vcs.push`, …) are the core's, whichever plugin provides it.

### Policy

`policy:` is what the person lets stand in for them, each step named `<workflow>.<step>`: `stand_in.gates`, the gates a supervisor may decide, and `stand_in.attended`, the `attended: agent` steps whose questions a supervisor may answer ([The supervisor](#the-supervisor)). It is the one key whose order is reversed: only `<norn home>/config.yaml` grants it, and a repo file, which an agent inside its step can change, may only narrow it. Each repo file that sets a list keeps only what it names of the user file's list, so a grant only a repo file makes is no grant. `norn config set policy.…` is a person's command, and it says so when a repo file narrows what it wrote.

`policy.allow` caps every step's grant: the capabilities any role may be granted on this machine, every one when no file sets it; a repo file narrows it from the user file's list, or from every capability when the user file sets none ([What an agent step may do](#what-an-agent-step-may-do)).

```yaml
policy:
  stand_in:
    gates: [story.human-qa]          # only the user file grants this
  allow: [code:read, code:scratch, code:write, docs:write, exec:checks, out:findings, out:criteria]
```

A supervisor answers a granted step's questions today. No granted gate is handed to one yet: that needs every executor to run inside an OS sandbox, which no shipped runner or harness declares, and a bound on the steps after the gate and an allowlist of the item's authors, which are not built. Every gate still waits for the person, and its inbox item says why. A granted gate already counts against the floor a workflow is checked against when it loads ([Workflow floor and confirmation](#workflow-floor-and-confirmation)).

### The supervisor

A **supervisor** is an agent norn launches beside a step's own run, on the executor `bind.supervisor` names (else `executor`), in the runner `runners.agent` picks. It stands in for the person only where their user-scope policy grants it, and only within that reach:

- **A question.** When the agent of an `attended: agent` step that `policy.stand_in.attended` names asks (`norn ask`), the tick launches the supervisor for that question (`supervisor.ask`, its `supervisor.started` receipt first). It answers once with `norn done answer --note "…"`, and the agent gets the answer marked as the supervisor's, never the person's; or it hands the question back with `norn done escalate --note "…"`, and the question stays the person's for the visit.
- **What goes straight to the person.** A question that names a merge, a push, a release or another write past the repo, or a gate's decision (`supervisor.reserved`); one the supervisor handed back; and one past the step's `limits.asks` (three a visit unless the step says, `supervisor.asks_spent`). They wait in the mailbox for `norn story answer`, never in a stuck unit. An answer that names such a capability is refused (`supervisor_grants`): a supervisor's answer grants nothing.
- **A gate.** A gate `policy.stand_in.gates` names is not delegated yet (above), so no supervisor starts for one. The record already holds a delegated decision to its visit: a `gate.decided` marked `delegated` stands only with the gate's visit and the run of that visit's supervisor on it; one from any other run or visit is refused.
- **Its brief** (`norn brief` in its session) names the step, its grant, and the question; the question, the handoff and the story's files are marked untrusted, as data and never instructions. It runs under the docs-only guard and is asked to change nothing.
- **Bounded.** A supervisor with no answer within `kernel.silent_after`, or whose process ended, or whose grant the person withdrew hands its subject back (`supervisor.silent`, `supervisor.died`, `supervisor.revoked`). The person may answer or decide first; a supervisor overtaken that way is stopped, and its late word is refused.

```yaml
bind: { supervisor: deep }
policy:
  stand_in:
    attended: [story.implement]      # only the user file grants this
```

### Executors and runners

A workflow names roles; this machine's config says what runs them. An **executor** is a harness (the agent: `claude`, `pi`) and its `model` and `args`. `bind:` maps an agent role, or one workflow's step as `<workflow>.<step>`, to an executor or a list of them; a step's binding outranks its role's, and a step bound to neither runs on `executor`, or on the only executor when there is one. The **runner** (where the agent runs: `headless`, `herdr`) follows the step's `attended:` from `runners:`:

```yaml
executors:
  deep:  { harness: claude, model: opus }
  other: { harness: pi }
executor: deep
bind:
  builder:      [deep, other]   # tried in order
  reviewer:     other
  story.review: deep            # one step on another executor, without a new role
runners: { person: herdr, agent: headless, none: headless }
```

- **The first executor that can run the step does.** It must be configured, have presence (a runner where a person can work beside the agent) when the step is `attended: person`, and a harness that can refuse a tool call when the step writes only docs. With none, the unit parks `stuck` before an agent starts, with the first one's rule (`agent.no_executor`, `agent.no_presence`, `agent.unguarded`) and every one's reason. A retry stays on the executor and runner its run started on.
- **`runners:` defaults** to `headless` for `agent` and `none`, and to nothing for `person`: an attended step parks `agent.no_presence` until `runners.person` names a runner with presence (`norn config set runners.person herdr`). It never runs as an auto run with nobody beside it.
- **An executor with a `runner:` of its own** runs every step there, whatever its attendance, as configs written before `runners:` do; an attended step on it parks `agent.no_presence` unless that runner has presence.
- A run's record names its executor and runner together: `deep@person` is executor `deep` in the runner `runners.person` picks.

### Worktree setup

`setup:` is the command that readies a unit's worktree before anything runs in it, such as installing its dependencies, so neither a check nor an agent installs by hand:

```yaml
setup:
  command: bun install --frozen-lockfile   # run with sh -c in the unit's worktree
  inputs: [bun.lock, package.json, "packages/*/package.json"]
  timeout: 15m                             # default 15m
```

- **When it runs.** Once in each new worktree, and again before an agent step's run or a check runs there when its digest changed: sha256 over the command and the content of each file `inputs` names, a missing one counted as missing. Editing the command runs it again; with no `inputs` it runs once per worktree. A step kind (`vcs.*`, `forge.*`) never waits on it.
- **Inputs** are paths relative to the worktree; `*` matches within one path segment. A leading `/`, a `..` segment and `**` are refused.
- **While it runs** the step waits: no intent is written, so it spends no retry and no counter, and the next tick looks again. It runs detached, as a check does, and is stopped at `timeout`.
- **A failure** (a non-zero exit, a timeout, a setup that ended without recording its exit or could not start) parks the unit `worktree.setup.failed`. `norn status` shows the command, how it exited, the worktree, the log and its last line, and names `norn run rerun <unit>`, which runs it again once the command or its files are fixed.
- **Its record** (what last ran, its digest and its log) is machine-local, under the machine dir's `runtime/setup/`. A worktree made again runs setup again; a finished story, `norn tidy` and a worktree `norn story update-branch` removes take the record with them.
- **Trust** is that of `checks.*`: the config comes from the main checkout, so a branch's edit to it applies once it merges. The setup should leave the worktree clean: a file it writes that git does not ignore is the agent's to explain.

## Steps

A step is written with thirteen keys, and the set never grows: what an actor needs beyond them goes under `with:`, and a step kind is named by value.

| Key | What it says |
|---|---|
| `by` | who acts: an agent role (`builder`, `reviewer`, `qa`, `investigator`, `writer`), `person`, `shell`, or a step kind as `<namespace>.<kind>` |
| `do` | an agent's instruction, the decision a person makes, or the command a shell step runs |
| `with` | how the actor works: an agent's `skills`, a shell step's `exits` (exit code → outcome), a step kind's settings |
| `reads` | what an agent step's brief gives it ([Inputs](#inputs)); `norn.each` takes `[slices]` |
| `produces` | what every outcome of an agent step produces, unless the outcome lists its own ([Outcomes](#outcomes)) |
| `allow` | what an agent step asks of its role's capabilities: it narrows them, never widens them ([What an agent step may do](#what-an-agent-step-may-do)) |
| `attended` | who stays alongside the agent, which picks its runner: `person` (in a runner with presence; the person starts the step), `agent` (a supervisor), `none` (the default) ([Executors and runners](#executors-and-runners)) |
| `limits` | an agent step's `deadline`, `nudges` and `retries`, and on an `attended: agent` step `asks`, the questions its supervisor answers in a visit; a shell step's `timeout`, which it needs |
| `outcomes` | where each outcome leads ([Outcomes](#outcomes)) |
| `on` | what may move a waiting step, a person's or a wait step kind's, by signal ([Signals](#signals)) |
| `description`, `use`, `like` | a note; `use: <file>` brings in `shared/<file>.yaml`; `like: <step>` copies a step of the same file, each key it writes replacing the copied value whole |

```yaml
test:
  by: shell
  do: "{checks.test}"
  limits: { timeout: 15m }
  outcomes: { pass: review, fail: implement }
checks:
  by: forge.await-checks
  outcomes: { pass: ready, fail: { exit: failed }, stale: { exit: stale } }
merge:
  by: forge.await-merge
  outcomes: { merged: $done }
  on: { vcs.stale: { exit: stale }, vcs.unpushed: open-pr }
```

A step kind's namespace is the slot it works over, `vcs.` (`update-branch`, `integrate`, `push`, `verify-base`) or `forge.` (`open-pr`, `await-checks`, `await-merge`), so a workflow moves between providers unchanged; a kind over no slot is named after its plugin (`vercel.preview`), and `norn.each`, which runs the story's slices through `kernel.slice_workflow`, is the core's. A signal is named the same way (`vcs.stale`, `norn.timeout`). Each actor takes only its own keys, and a key of the older form in a step written with `by:` is refused with where it is written now (`skills` under `with:`, `inputs` as `reads:`, `timeout` under `limits:`, `writes: docs` as `allow: [docs:write]`). An agent role picks no executor: the machine's `bind:` does ([Executors and runners](#executors-and-runners)); a step that must name one, or a `model`, in the workflow keeps the older form. The roles are the pack's: the shipped pack registers `builder`, `reviewer`, `qa`, `investigator` and `writer`, each with its purpose and the capabilities it may be granted, and a `supervisor`, which no step names.

A workflow sets the stale signal's settings once, and names the step `norn story update-branch` re-enters:

```yaml
signals: { vcs.stale: { when: conflict, verify: test } }   # when: conflict (default) or behind
entries: { update-branch: update }
```

### Workflow floor and confirmation

**The floor.** A workflow loads only when a person stands before every effect they cannot take back. A step kind declares such effects: `outward` (it reaches past the repo and its story branch: a deploy, a release), `cost` (it spends money) and `forge-write` (it changes what a forge lets others merge: `forge.await-merge` marks the draft ready). Every path to such a step, from `start` and from the entry `norn story update-branch` re-enters, must pass a `by: person` step that no policy grant delegates ([Policy](#policy)). A file that breaks it is refused at that step, with the path that reaches it, as a refusal in `norn doctor` and when a round would start on it:

```text
step merge (forge.await-merge) writes to the forge, and start reaches it through build → merge with no `by: person` step on the way: put a person's step no policy grant delegates on every path to it
```

Opening the draft pull request (`forge.open-pr`) pushes only the story's branch and asks no one to merge, so the shipped workflows open it before the person's `ready` gate. A round already under way keeps the revision it pinned, whatever the policy grants since; a person who starts a round at a step (`norn story round --at`) stands there themselves.

A workflow that stands on the floor with nothing granted but not under the person's grants is the policy's to narrow, not a broken file: ticks, `watch` and `doctor` go on, units already on it keep ticking, and only new rounds of it are refused (`workflow_policy_floor`) or park, naming `policy.stand_in.gates`. `norn doctor` warns which workflow starts no new round and which gates its grant delegates. A revision the person confirmed is weighed on the floor the policy sets now, matched by its own `name:`: once a grant takes it off the floor, new rounds run the pack's revision, or none, and doctor's held warning says why.

**Confirmation.** A repo's own workflow file can be changed by an agent inside its step, so a change to what the person stands on is held until the person confirms it: a `by: person` step added, removed or changed (its decision or its routes), or an agent step's `attended:` or `allow:`. Until then new rounds run the revision the person last confirmed, else the pack's file of that name; a workflow only the repo has is weighed against no steps, and one with any of these waits with nothing to run. Any other change (an instruction, a route, a new step that sets neither key) runs as it is, and so does a change back to the pack's own guarded parts while nothing is confirmed. Once the person confirms a revision it is the only baseline: a file edited back to the pack's gates, or removed, is held like any other change, so a person's step they confirmed is never dropped without them. Ticks go on, and the held workflow is impossible to miss: every `norn tick` reports it among its problems (`watch` says it once), with what new rounds run meanwhile; `norn doctor` names each held workflow and what changed; `norn story create` (for the workflow it names, or the default when it names none) and `norn story round` refuse a held workflow (`workflow_held`) until the person confirms it, so nobody starts a round on the pack's file believing it runs the repo's. A story a tick takes in from the tracker on a held workflow runs the revision named in the tick's problem, and one asking for a workflow with nothing to run parks saying so. `norn workflow confirm <name>`, a person's command, keeps the revision the file loads to now in the machine dir (`<norn home>/repos/<repo>/workflows/<name>.json`), and the next tick runs it:

```text
workflow story is held for your confirmation (person step ready removed); new rounds run the pack's revision — do instead: norn workflow confirm story
```

**On upgrade.** No revision is confirmed the first time a norn with confirmation meets a repo, so every repo copy of a pack workflow that differs from the pack in a guarded part is held at once, and runs the pack's file, and every repo-only workflow with a person's step runs none of it, until the person confirms each one. Nothing is trusted on first use: the files an agent could have changed before the upgrade are the ones to look at. After upgrading, run `norn doctor` (or read the first tick's problems) and confirm each workflow it names that you mean to run as written.

**The older form.** One head key per step, `agent: <instruction>`, `check: <command>`, `gate: <decision>`, `slices:`, or a step kind's bare name with no value (`open-pr:`), with `skills:`, `inputs:`, `writes:`, `attended: true`, `timeout:`, `exits:` and the step kind's settings beside it, and `base: { stale, step, verify }` for the workflow. It still loads, and pins the same document: a unit pins every workflow in that form, so a pin's hash never depends on which form its file used.

## Signals

A person step or a wait step kind (`forge.await-checks`, `forge.await-merge`) routes signals under `on:`, beside its `outcomes:`. Each entry takes the route shape of `outcomes:` (a step name, `$done`, `$stuck`, or `{to | exit, max, counter}`), plus the signal's own parameters. The edge is `<step>.<signal>`, so `counter:`, `reset_on` and `norn run rerun --reset` name it as they name an outcome's. A route back is bounded by `kernel.counters.stale` (10) unless it sets `max:`.

| Signal | Source | Parameters | Fires when | Occurrence id |
|---|---|---|---|---|
| `vcs.stale` | vcs | none | the base moved under the story the way the workflow's `signals: { vcs.stale: { when } }` names: `behind` (the base has a commit the story lacks) or `conflict` (the default: merging the base conflicts, or with `verify:` breaks the merged tree) | the base commit |
| `vcs.unpushed` | vcs | none | the story branch moved past its open change's head with commits beyond the story's spec folder | the story head |
| `norn.timeout` | clock | `after:` a duration (`30m`, `48h`, `7d`), required | the step has waited `after:`: a gate since it parked, a wait step since its run started | the step visit (`ready#3`) |

A plugin declares more under `provides.signals`, named `<slot>.<signal>` when it declares a slot and `<plugin>.<signal>` otherwise; `norn plugin list` names them, and a workflow that routes one loads only with that plugin configured. A signal fires once per occurrence id in a round, the first listed first, one per tick, and only for the story's own unit. `on:` on an agent, shell, effect step or `norn.each` is refused, and so is an undeclared signal, a signal named without its namespace, or a name under both `outcomes:` and `on:`. A wait step kind that answers a signal's name as its own outcome (`await-merge` answers `unpushed`) takes the one route under `on:` for both. A waiting step in the older form names signals bare (`stale:`); one written before `on:`, with `stale` or `unpushed` under `outcomes:`, still loads to the same graph; `norn doctor` warns about a repo file in that form.

## Inputs

An agent step's `reads:` (`inputs:` in the older form) lists what its brief gives it. norn writes each one under `.agents/` in the unit's worktree (its own inputs in the run folder's `in/`, `$NORN_IN`), and the brief names its path; an input norn holds nothing for yet is listed with a note. Every agent step reads and keeps its unit's handoff, whether or not it lists it.

| Input | What the agent gets |
|---|---|
| `spec` | the story's spec, `.agents/specs/<story>/spec.md`: its tracker item, mirrored, and the sections later steps added |
| `handoff` | this unit's handoff, `.agents/specs/<story>/handoffs/<unit>.md`, which the agent keeps current |
| `last_check` | the last check's exit, outcome and the end of its output |
| `findings?` (`last_findings`) | the open findings (below): a rejected gate's reason, or the report of a step whose outcome produced findings |
| `signal` | the signal that moved the story from where it waited, with what its source reported; the agent step right after a signal gets it whether or not it lists it |
| `diff` | the `git diff` command that shows the change so far |
| `slice` | this slice's file, `slices/<nn>-<slug>.md` in the story's spec folder |
| `slices` | every slice file of the story, with where each slice stands |
| `record` | the story's record: every unit's outcomes, gate rulings and criteria reports with their evidence |
| `resolution` | the resolution to review: each merge's remerge-diff and the conflicts this round recorded |
| `base_side` | the base side of a conflict: the base commit to merge and what it changed in each conflicting path |

**The open findings.** `findings?` names one report, never a history, and pins as `last_findings`, the name the older form gives it:

1. the report that sent this visit back (a rejected gate, or an outcome that produced findings), when one did;
2. otherwise the latest one this round that no clean outcome has settled since: a gate's `approve`, or the producing step reporting an outcome without findings (a review of the rework reads the findings that sent implement back);
3. otherwise none, and the brief says so.

A red check is passed over in the search, never a stop: it carries no findings, and the ones before it are still what the rework answers. Two producers sending findings into one step (QA's `fail` and a person's `reject` at `human-qa` both reach `implement`) need no naming: the one that sent this visit back is open.

An entry may also be a file in the repo, `{file: <path>, label: <text>}`, which the brief names as it is, a name an earlier step produces (below), or a source the workflow names ([Sources](#sources)). A trailing `?` makes a produced name or a source optional: no producer need come before the step, and a source nothing binds does not hold it; on one of norn's own inputs it changes nothing, as norn notes any input it holds nothing for. A workflow file naming any other input is refused when it loads, at the step and the entry (`/steps/review/reads/2`), with the names above. A unit's pinned workflow loads without this check, so a pinned workflow that names one keeps running, and its brief notes that norn provides no input of that name.

### Sources

A source is a place the steps read that is neither norn's nor the repo's code: design assets, decision records, a style guide. The workflow names it portably under `sources:`, and each machine binds it in its config, which wins over the workflow's own `path:`:

```yaml
sources:
  adr:   { type: folder, path: docs/adr }   # bound by the workflow, relative to the repo's root
  brand: { type: folder }                   # bound by each machine: norn config set sources.brand <path>
steps:
  design:
    by: builder
    do: "Design the page from the brand assets."
    reads: [spec, adr, brand?]
```

- `type` is `folder` or `file`; the brief names the path, read-only, and norn copies nothing.
- A step that reads a source without `?` that nothing binds parks `stuck` (`source.unbound`) before an agent starts, with the command that binds it, and `norn doctor` names it beforehand. Binding it lifts the park on the next tick.
- A source takes a name of its own: not one of norn's inputs, not a name a step produces. It is spelt as a step's name is (lowercase letters, digits, `_` and `-`), and the config binds every name a workflow may give. A `path:` that leaves the repo is refused; bind a place outside it in the config.
- A workflow with `sources:` pins them, so its pin's hash covers them; a workflow without pins as it did before sources existed.

## Outcomes

A step's `outcomes:` routes each outcome it ends with. A route is a bare target (a step, `$done` or `$stuck`), or an object that says everything about the outcome in one place:

```yaml
qa:
  by: qa
  do: "Give each criterion a verdict with evidence."
  reads: [spec, slices, diff]
  produces: [criteria]                   # what every outcome produces, unless it lists its own
  outcomes:
    pass:       { to: describe, verdict: pass, means: "every criterion observed with evidence" }
    fail:       { to: implement, counter: qa_loop, verdict: fail, produces: [criteria, findings] }
    unverified: { to: human-qa, verdict: unverified }
```

| Key | What it says |
|---|---|
| `to` | the next step, `$done` or `$stuck` |
| `exit` | in a shared file, in place of `to`: the exit it leaves by, which the `use` step routes |
| `max` | the bound of the counter derived for this edge ([Recipes › Bound a loop](recipes.md#bound-a-loop)) |
| `counter` | a counter declared under `counters:`, shared with other edges, in place of `max` |
| `means` | what the outcome means, shown to the agent in the brief (agent steps) |
| `verdict` | the worst criteria verdict this outcome needs: `pass`, `fail`, `person` or `unverified` (agent steps) |
| `produces` | what the report of this outcome comes with, replacing the step's list whole; `[]` is nothing (agent steps) |

An entry of a `produces:` list is a report norn takes with the outcome, written bare, or a file:

- `criteria`: a criteria report ([Reports](#reports)). An outcome with a `verdict` produces it, and one without a verdict produces it only when every outcome of the step does.
- `findings` (or `evidence`): handed back with the outcome ([Reports](#reports)); an outcome hands back one of them. Findings become the next step's open findings ([Inputs](#inputs)). A person's `reject` at a gate produces findings from its reason without saying so.
- `{ name: <name>, file: <path> }`: a file the agent writes in the spec folder (below), declared once in the step and named bare in any other list of it.

`means`, `verdict` and `produces` belong to an agent step's outcomes; on a person's, a shell step's or a step kind's they are refused, and so is one on a route the kernel takes (`stuck`, `timeout`, …). A step says each of them one way: an outcome object's `means` with a step's `means:` map, or an outcome's `produces` with `criteria:` or `hand_back:`, is refused with the spelling to use. Outcome objects are how a file is written; a unit pins its workflow with the older keys (`means:`, `verdict:`, `criteria: required`, `hand_back:`, `produces: {<name>: {file, on}}`), which a file may still use, so the two spellings of one workflow pin the same document and hash.

### Reports

A report is a registered type with one place in the run folder's `out/`, which the launch names in the agent's env as `$NORN_OUT` (`.agents/run/out/` in the worktree, ignored by git) and empties before every run, leaving the folder in place for a shell redirect into it, so it holds only what this run wrote. `norn done <outcome>` collects each report there, validates it and keeps it on the run's receipt; a report that does not validate is refused with its path and its shape, at any outcome, and a missing one is refused where its outcome needs it.

| Type | Where | What it holds |
|---|---|---|
| `criteria` | `$NORN_OUT/criteria.json` | a JSON array with one verdict per acceptance criterion (`pass` with `evidence`, `fail` with `repro`, `person` with `how`, `unverified` with `reason` and `how`), covering exactly the unit's frontmatter `criteria` |
| `findings` | `$NORN_OUT/findings.json` | `{"findings": [...]}` or the array alone, each with a `title` and a `severity` (`blocking`, `major`, `minor`, `nit`), and where it can `file`, `line`, `criterion`, `detail` and `repro` |
| `evidence` | `$NORN_OUT/evidence/` | the files a criteria verdict's `evidence` names; a QA report keeps them on the remote ([Evidence](#evidence)) |

The brief lists every report and file the step produces under Outputs, each with where it goes, what it holds and the outcomes that need it, beside the handoff, which every agent step keeps whether or not its workflow lists it. `norn done --criteria <file>` and `--findings <file>` still read a report from elsewhere, in place of its file in `$NORN_OUT`.

### Evidence

When an agent's QA report goes through `norn done`, norn keeps the files in `$NORN_OUT/evidence/` as a commit on `refs/norn/evidence/<story>`, a ref of its own and never a branch, so they never touch the story branch, its diff or the base. `forge.open-pr` pushes that ref with the branch and links each file from the pull request body at that commit: a screenshot shows inline, any other file opens on the forge. A report with no evidence files keeps nothing, and a refused report keeps nothing.

- **Compression.** An image is scaled to at most 1600 px wide, its aspect kept, and re-encoded as WebP at quality 80, and the WebP is kept only when it is smaller. A GIF, an image the codec cannot read and any other file is kept as it was. A file still over 10 MB once compressed is not kept, and `norn done` names it. The files in `$NORN_OUT/evidence/` stay as the agent wrote them.
- **Who sees it.** The evidence is as visible as the repo: everyone who can see the repo sees it, and nobody else. Redact secrets before reporting.
- **Turning it off.** `evidence.publish: false` in any config file keeps nothing and pushes nothing, and the body names the files as text. A forge that cannot link a commit's files, such as forge-none, never publishes.
- **CI.** The ref is not a branch, so a CI that runs on branches and pull requests starts no run for it; a repo whose CI runs on every pushed ref starts a run for it.
- **Deleting.** norn never deletes the ref, so merged pull requests keep their evidence. Delete it by hand with `git push origin :refs/norn/evidence/<story>`.

### Produced files

An agent step declares the files it writes for later steps in a `produces:` list, each by a name of its own:

```yaml
describe:
  by: writer
  do: "Write the PR body to pr.md in the spec folder."
  produces: [{ name: pr_body, file: pr.md }]
  outcomes: { done: open-pr }
```

- `file` is relative to the story's spec folder, `.agents/specs/<story>/`; a path that may leave it (absolute, with `..`, a backslash or a drive letter) is refused, and so is a file norn writes there itself: `.gitignore`, `spec.md`, or one under `handoffs/` or `slices/`.
- The step's list is due on every outcome the step reports; an outcome that lists its own, such as `changes_requested: { to: implement, produces: [findings] }`, needs only what it lists. A name with no file in the step, or one name given two files, is refused. The older form, a map `pr_body: { file: pr.md, on: [done] }`, still loads: there `on:` names the outcomes, and without it every outcome but one that hands findings back. A file is never named `findings`, the open findings' name; a unit that pinned a workflow producing one before keeps reading that file.
- A produced name may not be an input norn provides, and every step producing one name writes the same file.
- `norn done <outcome>` is refused (`produced_missing`) while a file due on that outcome is missing or empty in the worktree; a file left by an earlier pass counts, as norn does not check that this run wrote it. The brief says which file each outcome needs.
- A later step lists the name under `reads:`, and its brief names the file. norn keeps the file with the story's documents, so a step in another worktree gets it too.
- A step that lists a produced name, or a step kind that reads one, must have a producer before it on every path from `start`, the producer reporting an outcome the file is due on. A file where some path lacks one is refused when it loads, naming the step and that path (`plan.skip → review`). A route back is fine.

A step kind may produce files too, under the same rule: its plugin declares each name and file, the file is due on every outcome the kind answers, and a later step lists the name under `reads:` as it would an agent step's. A name produced by a step kind and an agent step names one file.

The bundled `describe` steps produce `pr_body`, which `open-pr` reads. `open-pr` reads it with a fallback: a base update's light path reaches `open-pr` again without `describe`, and then it reads the `pr.md` an earlier pass left, else opens the change with norn's footer alone. A unit that pinned its workflow before `produces:` existed loads it to the same graph and hash.

## What an agent step may do

An agent step's **grant** is what its agent may do: the capabilities its role may be granted (the pack registers each role with them), narrowed by the step's `allow:`, capped by the person's `policy.allow` ([Policy](#policy)). `allow:` names only capabilities its role has: asking for more is refused when the workflow loads (`role writer may not be granted \`code:write\``). decide works the grant out on each tick from the pinned role and `allow:` and the config, and the brief states it under Rules ([Concepts](concepts.md#what-an-agent-step-may-do)). A step in the older form names no role, so nothing narrows it: it writes what its `writes:` says.

| Capability | The agent may |
|---|---|
| `code:write` | change the code and keep it: its commits reach the next step |
| `code:scratch` | change the code for the run alone: norn resets it once the agent reports |
| `code:read` | only read the code (also a grant that names no code level) |
| `docs:write` | write the story's documents in its spec folder, and the handoff |
| `exec:any`, `exec:checks` | run any command, or only the repo's checks and commands that read |
| `out:criteria`, `out:findings`, `out:evidence` | write that report to `$NORN_OUT` |
| `tracker:comment`, `tracker:label` | comment on or label the story's item |
| `read:any`, `answer`, `decide:granted`, `escalate` | the supervisor's, which no step names |

The shipped roles: `builder` (`code:write`, `docs:write`, `exec:any`), `reviewer` (`code:read`, `docs:write`, `exec:checks`, `out:findings`), `qa` (`code:scratch`, `exec:any`, `out:criteria`, `out:evidence`, `out:findings`), `investigator` (`code:scratch`, `exec:any`, `out:findings`, `tracker:comment`, `tracker:label`), `writer` (`docs:write`) and `supervisor`.

### The three code levels

| Level | Held by | At `norn done` |
|---|---|---|
| `code:write` | `git status` | refused while changes outside norn's own files are not committed (`dirty_worktree`) |
| `code:scratch` | a snapshot and its check | a lockfile changed is reset without a word; any other tracked change, or a commit, refuses an outcome whose verdict is `pass` (`code_changed`), so nothing stubbed can pass behind the reset; on any other outcome everything the run changed is reset, commits included |
| `code:read` | the docs-only guard, a snapshot and its check | refused while a tracked file outside norn's own differs, or a commit was made, since the run started (`code_changed`) |

A step that may change no code (`code:read`) runs under the docs-only guard: its file-tool writes go only to the story's spec folder (`.agents/specs/<story>/`), the run folder's `out/` (`$NORN_OUT`) and the temp folders (`$TMPDIR`, `/tmp`), and it needs an executor whose harness can refuse a tool call (`denyTool`): on any other the unit parks `stuck` with `agent.unguarded` before an agent starts. The older form's `writes: docs` (and `allow: [docs:write]`) asks for the same guard. Every step is refused a write into norn's run state. norn's own files never count as a change: the run folder, the story's spec folder and what it installed for the executor (its hooks, its skill links). A file a `code:read` or `code:scratch` run leaves untracked refuses its done until it is removed.

### Detection, as receipted effects

Before the agent of a step that may not keep code starts, norn writes the run's intent and then a `run.snapshot` receipt: HEAD, the tracked tree as the worktree holds it, the repo's refs (all but the remote-tracking ones and norn's own), its git config (all but the tracking keys `branch.<name>.remote` and `.merge`, which git writes and removes as other units' branches come and go, and which no push norn makes reads) and hooks, and the remote's copy of the story branch. A retry is checked against its visit's first snapshot. vcs-git takes the tree through a throwaway index in the worktree's git dir and never writes the worktree's index or a ref, so a file touched without a change (an editor, an install) moves nothing; a checkout with unmerged paths, a merge stopped on its conflicts, gives no snapshot. A snapshot that cannot be taken (a vcs without one, git failing) parks the unit `stuck` (`run.snapshot.failed`) and the agent never starts: the park names the git call, the worktree, how it exited and what git said, and `norn status` names `norn run rerun <unit>` once the checkout is fixed.

`norn done` compares at once and refuses what the level does not allow, saying what changed and how to put it back. Before the report routes, the next tick's `agent.check` stops the run's processes, so a write left running in the background cannot land after the check (the headless runner kills the run's process group, even once the agent itself has exited; see [Limitations](limitations.md) for the Herdr runner), compares again, and resets what the level resets under a `run.checking` intent and a `run.checked` receipt, safe to run again after a crash. A change only this check finds (it landed after `norn done`), or a check that cannot be done, refuses the report and parks the unit `stuck` (`run.check.refused`, `run.check.failed`): it never passes. At either level a moved remote story branch, a changed git config or a changed hook refuses too; another ref that moved (a sibling unit's branch, a person's tag) is only noted, as norn cannot tell who moved it.

Every agent run's launch pins a digest of its hook config (norn's hooks, and any setting that turns hooks off), and `norn done` is refused (`hooks_changed`) once it differs.

### What is enforced, honestly

Without an OS sandbox an agent's shell can reach anything the person's user can, so norn claims only this:

| Level | Without an OS sandbox | With one (a runner or harness that declares `sandbox`; none ships yet) |
|---|---|---|
| prevented | file-tool writes (the hook guard); a plugin step kind whose effects the person has not accepted | the store, `.git/refs`, `.git/hooks`, `.git/config`, the main checkout, the network |
| detected | tracked files in the unit's worktree, HEAD, the remote story branch head, the repo's git config and hooks, the run's hook config | the same |
| advisory | `exec:checks` against `exec:any`, `tracker:*`, the `out:*` reports a role may write, shell git (refs, stash, worktree, push), the store, a gate command run from the agent's shell, the network | none of these |

An advisory capability is the brief's word and nothing more ([Limitations](limitations.md)). A grant may be widened only over what is prevented or detected: since an agent's shell could write a gate's decision itself, no gate is handed to a supervisor without a sandbox, and none is handed to one yet ([The supervisor](#the-supervisor)).

## Generated reference

<!-- norn:reference:start — generated by `bun run docs:emit`; edit the cli, not this block -->

### Commands

Every command also takes `--json` (one JSON value instead of markdown) and `--help`.

#### Setup

##### `norn init`

Set up norn in this repo: detect the tracker, forge and executor, write the config, run doctor

```sh
norn init [--tracker <name>] [--forge <name>] [--store <name>] [--executor <harness>] [--runner <name>] [--mode auto|manual] [--commit] [--yes]
```

- `--tracker <name>`: the tracker plugin (detected: github when origin is on GitHub and gh is present, else local)
- `--forge <name>`: the forge plugin (detected: github with the github tracker, else none)
- `--store <name>`: where run state lives (default local)
- `--executor <harness>`: the default executor's harness (detected: claude when it is on PATH, else pi when it is)
- `--runner <name>`: where agents run (default headless; herdr when inside herdr and asked)
- `--mode auto|manual`: how agent steps start: auto on their own, manual when a person runs norn run start (default auto with the headless runner, else manual)
- `--commit`: write the committed config (.agents/norn.yaml, team mode) instead of the repo-local one (.agents/norn.local.yaml)
- `--yes`: take every detected choice without asking

##### `norn doctor`

Check the config, plugins, workflows, harness hooks and tools this repo needs, and bring the pack's skills in the checkout up to date

```sh
norn doctor [--repo]
```

- `--repo`: check only the repo's own config files (never the user's), plugins, slots and workflows; no hooks or tools (CI)

##### `norn config` (noun)

Read and change the config

##### `norn config get`

Print one config key of the merged config

```sh
norn config get <key>
```

##### `norn config set`

Set one config key in the repo-local file (the committed one with --commit)

A person's command when it sets a `policy` key: refused then in an agent's session (`person_only`).

```sh
norn config set <key> [<value>] [--commit] [--user] [--unset]
```

- `--commit`: write the committed config (.agents/norn.yaml)
- `--user`: write the user config (<norn home>/config.yaml)
- `--unset`: remove the key instead of setting it

##### `norn config show`

Print the merged config and which file set each key

```sh
norn config show
```

##### `norn plugin` (noun)

Install, list, update and remove plugins

##### `norn plugin add`

Install a plugin (npm spec, git URL or local path) and pin it in the lock

A person's command: refused in an agent's session (`person_only`).

```sh
norn plugin add <spec>
```

##### `norn plugin list`

List the bundled and installed plugins and what each provides

```sh
norn plugin list
```

##### `norn plugin remove`

Unpin an installed plugin from this repo's lock

```sh
norn plugin remove <name>
```

##### `norn plugin update`

Update an installed plugin to the newest version its spec allows

A person's command: refused in an agent's session (`person_only`).

```sh
norn plugin update <name>
```

#### A person's commands

##### `norn status`

Show every story and unit, read-only; --watch: the live cockpit; --segment: one line for herdr's tab bar

```sh
norn status | norn status --watch [--interval 5s] [--pane] | norn status --segment [--ttl 30s]
```

- `--watch`: the live cockpit: what needs you and every story, acted on by key; q or Esc quits
- `--interval <duration>`: with --watch: how often it reads the stories again (default 5s)
- `--pane`: with --watch: open it in a herdr pane below this one, leaving the focus here
- `--segment`: one line for herdr's tab bar, empty outside a norn repo; inside herdr also each story's $norn sidebar token
- `--ttl <duration>`: with --segment: how long a sidebar token stays without the next segment (default 30s)

##### `norn story` (noun)

Stories: list, view, create, the person's decisions, the next round, taking one to this machine, and updating a finished one's branch

##### `norn story list`

List the stories norn tracks

```sh
norn story list
```

##### `norn story view`

Show one story: its units, runs, gates and asks

```sh
norn story view <key>
```

##### `norn story create`

Create an item on the configured tracker (a GitHub issue, a local markdown file) with the intake label, so the next tick takes it in

```sh
norn story create <title> [--body <text>] [--workflow <name>]
```

- `--body <text>`: the item's body
- `--workflow <name>`: the workflow the story takes at intake

##### `norn story approve`

Approve the gate a story waits at

A person's command: refused in an agent's session (`person_only`).

```sh
norn story approve <key> [--gate <step>] [--reason <text>]
```

- `--gate <step>`: the gate step, when the story waits on several
- `--reason <text>`: a comment kept on the decision

##### `norn story reject`

Reject the gate a story waits at, with the reason the next attempt gets

A person's command: refused in an agent's session (`person_only`).

```sh
norn story reject <key> --reason <text> [--gate <step>]
```

- `--gate <step>`: the gate step, when the story waits on several
- `--reason <text>`: required: what failed; the agent sent back gets it

##### `norn story answer`

Answer the question a story's agent asked, or the permission or trust prompt in its pane

A person's command: refused in an agent's session (`person_only`).

```sh
norn story answer <key> <text>   (a prompt in the pane: an option's number, yes or no)
```

##### `norn story round`

Start a story's next round on a workflow

A person's command: refused in an agent's session (`person_only`).

```sh
norn story round <key> --workflow <name> [--at <step>] [--force] [--reason <text>]
```

- `--workflow <name>`: the workflow the round runs, pinned as it loads now
- `--at <step>`: the step the round starts at (default: the workflow's start)
- `--force`: end the round still under way first
- `--reason <text>`: why, kept on the record

##### `norn story take`

Take a story's claim to this machine, so its next tick carries the story on

A person's command: refused in an agent's session (`person_only`).

```sh
norn story take <key> [--force] [--reason <text>]
```

- `--force`: take over a claim another machine holds, live or expired
- `--reason <text>`: why, kept on the record

##### `norn story update-branch`

Merge the base into a finished story's branch and push it, for its open change

A person's command: refused in an agent's session (`person_only`).

```sh
norn story update-branch <key> [--reason <text>]
```

- `--reason <text>`: why, kept on the record

##### `norn story close`

Close a story and stop its runs

A person's command: refused in an agent's session (`person_only`).

```sh
norn story close <key>
```

##### `norn run` (noun)

Runs: start one manual mode holds, stop a live one, run a step again, bring one's pane in front

##### `norn run start`

Start the agent of a step manual mode holds, or of an attended step

A person's command: refused in an agent's session (`person_only`).

```sh
norn run start <unit>
```

##### `norn run stop`

Stop a unit's live run

A person's command: refused in an agent's session (`person_only`).

```sh
norn run stop <unit>
```

##### `norn run rerun`

Run a unit's step again, or move it to another step, counters reset

A person's command: refused in an agent's session (`person_only`).

```sh
norn run rerun <unit> [--step <step>] [--reset <counter>]... [--reason <text>]
```

- `--step <step>`: the step of the unit's pinned workflow to run (default: the step it is at)
- `--reset <counter>`: set a counter of the workflow back to 0 (repeatable)
- `--reason <text>`: why, kept on the record

##### `norn run attach`

Bring the pane of a unit's live run in front; --next: the agent waiting for you longest

```sh
norn run attach <unit> | norn run attach --next
```

- `--next`: the agent that has waited on you longest, without naming it

##### `norn workflow` (noun)

Workflows: confirm a repo workflow held for the person

##### `norn workflow confirm`

Confirm a repo workflow held because it changes a person's step, attended: or allow:

A person's command: refused in an agent's session (`person_only`).

```sh
norn workflow confirm <name>
```

#### Background: run by a person, cron or a terminal multiplexer

##### `norn watch`

Tick on an interval until a signal stops it

```sh
norn watch [--interval <duration>] [--max-ticks <n>]
```

- `--interval <duration>`: the longest pause between ticks, as 30s or 2m (default 30s)
- `--max-ticks <n>`: stop after this many ticks; an interval paused below the store's version floor counts as one

##### `norn tick`

Run one tick: read facts, decide, act

```sh
norn tick
```

#### Agent protocol: the only commands an agent runs

##### `norn brief`

Print the brief of the step this agent runs

```sh
norn brief
```

##### `norn done`

Report the step done with an outcome

```sh
norn done <outcome> [--note <text>] [--report-id <id>] [--criteria <file>] [--findings <file>]
```

- `--criteria <file>`: a criteria report written elsewhere than $NORN_OUT/criteria.json, read in its place
- `--findings <file>`: findings written elsewhere than $NORN_OUT/findings.json, read in their place
- `--note <text>`: what the next step should know
- `--report-id <id>`: the report's id; a retry with the same id records it once

##### `norn ask`

Ask the person a question and wait for the answer

```sh
norn ask <question> [--report-id <id>]
```

- `--report-id <id>`: the report's id; a retry with the same id records it once

##### `norn stuck`

Report the step stuck, with the reason (a reason ending in ? is asked as a question)

```sh
norn stuck <reason> [--report-id <id>]
```

- `--report-id <id>`: the report's id; a retry with the same id records it once

#### Called by a harness, not by hand

##### `norn hook`

Answer a harness hook: the payload on stdin, the harness's reply on stdout

```sh
norn hook <harness> <hook>
```

##### `norn lab-agent`

Run the lab's stand-in agent for the run in the launch env (the lab harness starts it)

```sh
norn lab-agent [--resume <session>] -- <prompt>
```

- `--resume <session>`: the session a resumed launch continues

#### Other

##### `norn help`

Show every command, or one command's usage

```sh
norn help [<command>]
```

##### `norn tidy`

Remove the worktrees and local branches of ended stories that no live claim holds, and close their runs' panes

A person's command: refused in an agent's session (`person_only`).

```sh
norn tidy [--dry-run]
```

- `--dry-run`: list what would be removed and change nothing

### Config keys

Every file takes every key: the user file, the repo-local file and the committed file, the nearer winning, except `policy`: only the user file grants it, and each repo file that sets a list keeps only what it names of the user file's.

| Key | Type | Default |
|---|---|---|
| `format` | `1` | `1` |
| `tracker.use` | string | none |
| `tracker.intake.label` | string | none |
| `tracker.intake.assignee` | string or null | `"me"` |
| `forge.use` | string | none |
| `store.use` | string | none |
| `vcs.use` | string | `"git"` |
| `executors.<name>.harness` | string | none |
| `executors.<name>.runner` | string or map | none |
| `executors.<name>.runner.use` | string | none |
| `executors.<name>.model` | string | none |
| `executors.<name>.args` | list of strings | none |
| `executor` | string | derived: the only executor |
| `runners.person` | string or map | derived: none, so an attended step parks until one with presence (herdr) is set |
| `runners.person.use` | string | none |
| `runners.agent` | string or map | `"headless"` |
| `runners.agent.use` | string | none |
| `runners.none` | string or map | `"headless"` |
| `runners.none.use` | string | none |
| `bind.<role>` | string or list of strings | none |
| `packs` | list of strings (one) | `["sdlc"]` |
| `plugins.<name>` | string | none |
| `base` | string | `"main"` |
| `base_ref` | string | derived: the remote's fetched copy of `base` (`origin/main`), else `base` |
| `holder` | string | derived: user@ the machine's LocalHostName, else its hostname, fixed in `~/.norn/holder.json` on first use |
| `kernel.mode` | `"manual"` or `"auto"` | `"manual"` |
| `kernel.workflow` | string | `"story"` |
| `kernel.slice_workflow` | string | `"slice"` |
| `kernel.intake_workflow_label_prefix` | string | `"norn:wf:"` |
| `kernel.max_nudges` | integer ≥ 0 | `2` |
| `kernel.max_retries` | integer ≥ 0 | `1` |
| `kernel.silent_after` | duration | `"15m"` |
| `kernel.deadline` | duration or `"none"` | `"1h"` |
| `kernel.claim_ttl` | duration | `"10m"` |
| `kernel.claim_renew_before` | duration | `"400s"` |
| `kernel.lock_stale` | duration | `"10m"` |
| `kernel.counters.check_fail` | integer ≥ 1 | `5` |
| `kernel.counters.gate_reject` | integer ≥ 1 | `2` |
| `kernel.counters.conflict` | integer ≥ 1 | `2` |
| `kernel.counters.stale` | integer ≥ 1 | `10` |
| `kernel.counters.agent_back` | integer ≥ 1 | `3` |
| `trace.retain` | duration or `"keep"` | `"7d"` |
| `checks.<name>` | string | derived: `checks.test` is "bun test", which the shipped workflows' test steps run; init detects the repo's own |
| `setup.command` | string | none |
| `setup.inputs` | list of strings | derived: none: the setup runs once per worktree |
| `setup.timeout` | duration | `"15m"` |
| `sources.<name>` | string | none |
| `policy.stand_in.attended` | list of strings | derived: none: a supervisor answers no step's questions |
| `policy.stand_in.gates` | list of strings | derived: none: every gate is the person's |
| `policy.allow` | list of capabilities | derived: none: every capability a role names may be granted |
| `evidence.publish` | boolean | `true` |

Beside `use`, `tracker`, `forge`, `store`, `vcs`, `executors.<name>.runner`, `runners.person`, `runners.agent`, `runners.none` take the keys of the plugin they name; that plugin checks them.

`evidence.publish` keeps an agent QA report's evidence on `refs/norn/evidence/<story>` of the remote and links it from the pull request body, so it is as visible as the repo; `false` keeps nothing and pushes nothing, and forge-none never publishes ([Evidence](#evidence)).

### Shipped workflows

The `sdlc` pack's workflows:

- `fix`: Reproduce a bug and confirm its cause, fix it test-first, review it, open the draft PR, wait for CI.
- `quick`: Make a small change (refactor, docs, chore, a reproduced bug's fix), check and review it, open the draft PR, wait for CI.
- `refinement`: Agree a story's spec and plan with a person, against the current base; no code.
- `reproduce`: Reproduce a bug through the real interface, confirm its cause and the seam for a regression test; change no code.
- `slice`: Build one slice test-first, check and review it, and integrate it into the story branch.
- `story`: Slice a planned story against the current base, run the slices, verify the story, open the draft PR, wait for CI.
- `triage`: Check an issue still holds, add its context, and end with the next round it recommends (refinement, quick, reproduce, fix) or closing it.

### Exit codes

| Code | Name | Meaning |
|---|---|---|
| 0 | `ok` | done |
| 1 | `error` | an unexpected failure: a bug or an IO error |
| 2 | `usage` | bad arguments |
| 3 | `refused` | a rule says no; `do_instead` says what would succeed |
| 4 | `corrupt` | a file norn keeps failed validation |
| 5 | `busy` | another process holds the lock or the claim |
| 6 | `config` | a config file a person wrote needs fixing |

<!-- norn:reference:end -->
