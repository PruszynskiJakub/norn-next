# Changelog

All notable changes to norn are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/). Before 1.0, a minor version may change the machine contract (JSON output, persisted formats).

## [Unreleased]

### Added

- The story PR gets a real description. A new `describe` step in the `story` template, after QA, runs the new `norn-pr` skill: it writes `pr.md` in the spec folder with a summary picture of the change, before/after evidence from QA's criteria reports and evidence, and the merge danger (one-way or two-way door, blast radius). `open-pr` uses that file as the PR body, with the issue link under it; without the file the body is the issue link alone, as before (GR9). Existing repos get the step from `norn init` only if they take the new template; add it to your own `story.yaml` to use it.
- A `norn-diagnose` skill for hard bugs, flaky tests and performance regressions, adapted from mattpocock/skills' `diagnosing-bugs`. It builds a tight, deterministic loop that goes red on the reported symptom before anything else, and allows no hypothesis until that loop has gone red; then it minimises the repro, ranks falsifiable hypotheses, instruments and bisects to the cause, and fixes behind a regression test, or hands the loop and cause back when told not to fix. It ships a template script for loops a person must click through, and redacts secrets.
- A `norn-prototype` skill, adapted from mattpocock/skills: it builds a throwaway prototype with a person to settle one design question, either a state model as one HTML file a non-developer can click through, or several radically different UI variants on one route switched by `?variant=`. The prototype is committed on the branch being worked on, in prototype-named files nothing in the product reaches; the spec links its path next to the decision it settled, with the question and the verdict. It is not a step of any workflow: `norn-refine` and `norn-plan` offer it when a decision turns on how something looks or feels, or on a state model hard to judge on paper, and with no person present only suggest it. `norn help` lists it with the skills a person works with the agent.
- A `norn-retro` skill, for a person to run with an agent after a story's PR merges. It reads the story's committed `runs/` (counters, receipts, check logs, handoffs) and the local trace when this machine has it, ranks the friction (counters that ran out, repeated rejects, asks, lost sessions, `unverified` criteria, checks that failed for the environment, findings that recur across slices) and suggests one change per finding to a skill, workflow, the config, the contributor docs or the spec template, each citing the receipt it comes from. It only suggests: it answers in the session and writes or changes no file.

### Changed

- `open-pr` on a story whose PR is already open now rewrites that PR's body instead of finishing at once, so after a `ready` reject and rework the PR describes the branch as it is (GR9). Both remote adapters gained `editPullRequestBody` (`gh pr edit --body`, `glab mr update --description-file -`).
- The `bug` workflow's `reproduce` step runs `norn-diagnose` instead of `norn-qa`: it still follows the report as a user first, then builds a loop that goes red on that symptom and finds the cause without fixing it, and leaves the loop, the minimised repro and the cause in the handoff for `implement`, which turns them into the red test. `norn init` installs the new template; a repo that already has `bug.yaml` keeps its own.
- `norn-implement` switches to `norn-diagnose` when a failing check or a QA repro does not fail on the first try (flaky, CI-only, timing), and builds a loop that goes red before writing the red test.

## [0.8.0] - 2026-10-27

### Added

- `norn orient <story|unit>` shows one story at a glance: what it is, each slice's outcome, the PR (link and the `gh pr view` / `glab mr view` command), the open notes grouped by unit, what waits for you with the exact commands, and where to look. Read only: no receipt, run or claim. Markdown by default, `--json` for data.
- `norn orient <story> --open` gives the story a Herdr workspace labelled `<story> orient` in its worktree, or focuses the one it has. The agent there opens with a short summary and answers your questions; it runs norn commands only when you say so and never edits code or reports an outcome (`NORN_ORIENT=1`: its hooks record nothing, and `brief`, `done`, `ask` and `stuck` refuse it). Outside Herdr it prints the command.
- `norn pick`: a picker for a Herdr popup. It lists what needs you, then every story; type to filter, the right side previews the story. Enter orients, ⌃o opens the PR in the browser, ⌃y approves a gate, ⌃g goes to the agent pane, ⌃t takes an unclaimed story; it stays open until esc.
- `norn status --segment` prints one line for Herdr's tab bar (`norn·todoist-app ● 1 approve ◐ 2 running`), or an empty one outside a repository. Inside Herdr it also shows on each orient workspace what its story needs (sidebar token `$norn`) and moves the orient workspaces that need you ahead of the others; no other workspace moves.
- The Herdr plugin has a `pick` popup and a `norn.pick` action. `plugins/herdr/README.md` has the config snippet for the key bindings, the tab bar segment and the sidebar row.
- `norn status` shows each story's branch, last-seen PR and open notes in `--json` (`branch`, `pr`, `notes`).

### Changed

- `norn help` says up front that an agent doing a step runs only `brief`, `done`, `ask` and `stuck`, and that every other command is the person's, for an agent to run only when the person asks it to. `norn help <command>` says so for a person's command, `--json` gives each command a `for` (`person`, `agent`, `hooks`), and a new Skills section (`skills` in `--json`) marks each bundled skill as the protocol, a step the agent works alone, a step a person works with the agent, or a reference. The `norn` skill gains the same rule: a refusal, the brief or the inbox naming a command is not the person asking.

## [0.7.1] - 2026-10-26

### Fixed

- The cockpit (`norn pane --interactive`) no longer wipes a half-typed command on each redraw. On a terminal the prompt is redrawn with what you have typed so far; before, the text vanished from view but stayed in the input and was glued onto the next command.

## [0.7.0] - 2026-10-26

### Added

- `norn tidy` closes what runs that reported done left in Herdr, when Herdr is the runner: the run's tab, or only its pane when the tab holds something else, and the workspace when nothing else is left. It only touches panes of done runs started on this machine that still work in the run's worktree, keeps one whose agent is still working, and lists them with `--dry-run` (K7).
- The cockpit (`norn pane --interactive`) shows Notes collapsed to one line with how many are new; `o` opens and closes them. Open, they are numbered and grouped by slice, newest first. Opening marks them seen on this checkout (HC16).
- `norn inbox --notes` lists the notes; without it `norn inbox` shows their header line only (NT6).

### Fixed

- A herdr launch is no longer reported as failed (an Unblock item, the pane closed, the run retried a minute later) when a short-lived process from the pane's shell startup, such as a `conda activate` subshell, holds the foreground and exits before norn identifies it. norn keeps waiting up to the start timeout for the agent to take the foreground.

## [0.6.0] - 2026-10-26

### Added

- `norn watch --human` prints for a person at the terminal: one line per action (`10:04:58  gh-1/06  agent.start → start_run`, failures marked `FAILED:`), nothing for a quiet tick, and a sentence on exit naming the claims it released. Without it `watch` prints JSON as before; `--json` wins over `--human`.

## [0.5.0] - 2026-10-26

### Added

- `norn config [<key>]` shows the resolved config: every setting with its value, the file it came from (built-in, `~/.norn/config.yaml` or `.agents/norn/config.yaml`) and one line on what it does, grouped by who it belongs to (this machine, you, the team). It notes a repo value a machine cap ignores, a machine setting the repo sets for everyone, `default_mode: auto` without a runner, and that an agent's `--permission-mode` is not norn's mode. `--json` for data.

### Changed

- The config template `norn init` writes groups its keys under The team, You and This machine, says which file each belongs in, and drops the spec ids.

### Fixed

- The config template no longer defines `agents.claude`, which replaced the built-in entry and dropped its `--permission-mode auto` args in every repo `norn init` set up. The entry is shown commented out, args included. A repo already set up keeps its file: remove its `agents:` block, or add the args to it.

## [0.4.0] - 2026-10-26

### Added

- `norn init` ends with numbered next steps to a first story: add the git remote if there is none, check the test command, commit and push the setup, `norn doctor`, make a labelled issue assigned to you, `norn sync`. Its JSON gains `remote` (the git remote's URL, `null` when missing) and `test_command`.
- `norn init` writes the repository's test command into the `test` steps of the workflows it creates, read from its build files: `package.json` (installing first with npm, pnpm, yarn or bun, since a check runs in a fresh worktree), `Cargo.toml`, `go.mod`, Python project files, `mix.exs`, Gradle, Maven or a Makefile `test` target. When nothing names one, the templates keep `bun test` and the next steps say to set it.
- `norn doctor` fails the remote check when the repository has no git remote named `remote.git_remote` (default `origin`), with `git remote add origin <url>` as the fix; before, it passed and the first tick failed. Its JSON gains `remote.git_remote`.
- The cockpit jumps to Herdr workspaces (HC15): `w <n>` focuses the workspace of the item's run, found by its recorded pane or by a pane in the unit worktree, never by label. `g <n>` falls back to the workspace when the run has no agent pane to focus, such as an approval after the agent ended.
- `norn inbox` in a repository with no stories says how to make the first one instead of only "nothing needs you".
- The README installs the binary with `curl` from the latest release, with no `gh` sign-in, now that the repository is public.

### Changed

- `norn help`, `norn`, `norn --help` and `norn <command> --help` print markdown for a person: the commands grouped with "Start here" first, without spec ids. `--json` prints the JSON they printed before.
- Agents' notes (`norn done --note`) get their own inbox group, Notes, below Running, instead of sitting under Check. Its header says which approval clears them (`cleared by gh-1 human-qa approval`, or `cleared when the story is done`), and they no longer count towards "needs you". In `norn inbox --json` they move from the `check` key to a new `notes` key; `check` keeps the other items (base moved, PR retarget, head changed, commits outside norn, local work not in the record).
- A slice gate's inbox item lists that slice's open notes, so the person sees them while deciding; approving the slice gate leaves them open, as before.
- Every inbox group title in `norn inbox` and the cockpit carries a few words on what the group holds.
- The cockpit draws Running in cyan and Notes in yellow, both undimmed; only Recently done stays dim, so work under way no longer looks finished.
- `norn doctor`: with `default_mode: manual`, a runner that is unavailable is a warning (`warn`), not a failed check, since only auto mode starts agents through it; the JSON says `runner.required`. Long errors are cut to one line in the report; `--json` keeps them whole.

### Fixed

- `norn inbox`, `norn pane` and `norn inbox --history` name an item's step once: `refine: attended step — work with the agent`, no longer `refine: refine: attended step …` (F4).
- `norn doctor` suggests a command that works for the cockpit plugin: `herdr plugin link <this checkout>/plugins/herdr` when norn runs from source, else `herdr plugin install PruszynskiJakub/norn-next/plugins/herdr`, now that the repository is public. The README says the same.

## [0.3.1] - 2026-10-26

### Fixed

- A story stuck at its slices step because every active slice was stuck resumes by itself once a slice can move again. Unsticking the slice is enough; `norn unstick <story>` is no longer needed as well (§10).
- A check no longer fails with "address in use" because a server an agent started from the worktree is still listening on its slot's ports. Before each check, norn stops such listeners and names them at the top of the check output (K4.1).
- `norn doctor` suggests `herdr plugin link <checkout>/plugins/herdr` for the cockpit plugin, naming this checkout when norn runs from source, instead of `herdr plugin install`, which cannot clone the private repo. The README says the same.

## [0.3.0] - 2026-10-25

### Added

- An attended agent that waits for you shows under Your turn (HC1–HC3). Once the agent of an attended step (refine, clarify, plan) has ended its turn, or waits on a question or permission prompt, for `limits.attended_wait` (default `2m`), the inbox moves it from Running to Your turn as `<step>: the agent is waiting for you`, and the notifiers fire once per wait. Its command reaches the waiting session; it never starts a second agent. Inbox items of a unit with a run carry `reach` (worktree, agent session id, pane id).
- `norn pane --interactive`, the cockpit (HC4–HC8): the inbox numbered, one command per line — go to an item's agent, answer, approve or reject, take, unstick, view the trace, jump to the next agent waiting for you. Every change runs through the CLI verbs. Inside Herdr it focuses agent panes and labels them in the sidebar (HC12). `norn pane --next` focuses the agent waiting for you once and exits, and `norn pane --open` opens the cockpit.
- A Herdr plugin in `plugins/herdr` (HC9): the cockpit pane and the actions `norn.open` and `norn.next`. `norn doctor` says whether it is linked when Herdr is the runner.
- Notifier `herdr`: inbox items as Herdr toasts (HC14).
- `norn open <unit> [--print]` opens an agent on a step a person starts (an attended step such as refine or plan, or a ready step in manual mode). With a runner that can open terminals (the new optional `open` capability and `openForPerson` on `RunnerPort`; Herdr has it) it opens one in the unit's worktree with the agent started on the brief, a focused Herdr tab; otherwise it prints the command to run (MO5).
- `norn inbox` lists a story taken in on this checkout that no tick has started yet: under Running while the heartbeat is up, else under Your turn with `norn watch`.

### Changed

- The brief says it is complete: the `norn` skill tells the agent not to read again what the brief gives (handoff.md, `.norn-unit`, `.env.norn`) nor survey the repository or the machine, `norn-implement` reads only the code and docs the criteria touch, and the brief's handoff input reads `Handoff (text under Context; update it here)`, since its text is already under Context.
- Commands an agent or a person reads print markdown by default: `done`, `ask` and `stuck` (the reply says what was reported and to end the turn), `init`, `doctor`, `status`, `inbox` and `trace`, like `brief` already did. Their refusals print as markdown too, with the same exit codes. Every command takes `--json` and then prints the JSON it printed before; `--text` is still accepted and changes nothing.
- `norn init` and `norn doctor` print a summary: one line per part or check, what changed or failed, and what to do. `doctor` still exits 1 when a check fails.
- A gate item in `norn inbox` names the report that led there by step and receipt number (`step qa#1 reported partial (receipt 0009)`) instead of printing its absolute path on the item line. The receipt and evidence paths moved to the item's full text (`norn inbox --details`), and the text output prints paths under your home as `~/…`.
- With a runner that can open terminals, Your turn items for starting an agent show `norn open <unit>` as the command and the `cd … && <agent> …` line in the detail (`by hand: …`). Without one they show the `cd …` line as before.
- `norn brief` outside a unit worktree tells the agent to stop and has the person start it from the unit's inbox item; the `norn` skill says the same.
- The cockpit (`norn pane --interactive`) draws its own frame: a header with the repo, what needs you and the heartbeat; one aligned row per item cut to the pane width, with its command dimmed beneath; colour per group on a terminal (`NO_COLOR` turns it off). `d <n>` shows an item's full text, and `?` lists every command.

### Fixed

- The Herdr plugin's `norn.open` action opens the cockpit: it passed `--cwd`, so the pane started outside the plugin folder and closed at once, and `--workspace` with `--target-pane`, which Herdr refuses.

### Upgrading

Scripts that parse the output of `done`, `ask`, `stuck`, `init`, `doctor`, `status`, `inbox` or `trace` must add `--json`.

## [0.2.1] - 2026-10-25

### Fixed

- `norn watch` no longer hangs for good after the laptop sleeps (H11). A `git fetch` or `push` whose SSH connection died while the machine slept never returned, so the tick held its lock, claims expired and nothing was applied until the process was killed by hand. Every call that reaches a remote (`git fetch`/`push`/`ls-remote`/`pull`/`clone`, `gh`, `glab`) now times out after 2 minutes, killing its whole process group (git and its `ssh`), and fails as a retryable network error; the next tick carries on.

## [0.2.0] - 2026-10-25

### Changed

- The skills are norn v0.11.0's again, adapted to this norn: its skill files are the base, edited only where the contracts differ (the spec and slices are files, nothing pushes or writes to the remote, QA verdicts and findings are JSON, the person decides at gates when no one works with the agent). Refactoring is out of the red → green loop again, tests go only at the Plan's agreed seams, review keeps the Spec and Standards axes apart (a subagent per axis when the agent has them), and QA redacts secrets and takes a screenshot of every criterion checked in a browser.
- Every skill but `norn` is prefixed `norn-` (`norn-implement`, `norn-review`, …), and the workflow templates name them so. The reference skills `norn-tdd` and `norn-codebase-design` and the person-led `norn-qa-person` are back, and skills ship as whole folders with their reference files (`SMELLS.md`, `tests.md`, `mocking.md`, …).
- The spec is one file again: refine writes Problem, Solution, Behaviour (`B1`…, each with an example), Out of scope and Open questions into `story.md`, and plan adds a `## Plan` section there instead of writing `plan.md`. The story template's plan and slice steps and the `approve-plan` prompt say so.
- `norn init` keeps one copy of the skills in `.agents/skills/` (commit it) and links them from each configured agent's skill folder (`.claude/skills/`, `.gemini/skills/`, `.opencode/skills/`). It always installs the bundled version and lists what it updated; the `norn-owned` marker is gone. To customize a skill, write your own under another name and name it in the workflow.
- A workflow step's skill must be installed for the agent that runs it (W5); a skill norn bundles but did not install no longer counts.
- The Claude Code plugin ships only the `/norn` command; the skills come from the repo.

### Added

- `norn init` marks `.agents/specs/*/runs/**` as generated in `.gitattributes` (`linguist-generated`, `gitlab-generated`), so GitHub and GitLab collapse receipts, state and logs in PR diffs. The files are still committed and pushed (S8, S10). Run `norn init` again in an existing repo to add the line.
- `norn doctor` checks the skills: missing from `.agents/skills/` or not linked from an agent's folder fails the check, a skill that differs from the bundled version is a warning.

### Removed

- `norn init --skills user`: skills live in the repo only.

### Upgrading

Run `norn init` and commit `.agents/skills/` and the links in your agents' skill folders. Then rename the skills in your own workflow files (`.agents/norn/workflows/*.yaml`, which `norn init` never overwrites): `implement` → `norn-implement`, and so on. In the story workflow, also have the plan step write the Plan section of `story.md` and drop `{ file: plan.md, label: plan }` from the slice step (compare with the new template). The 0.1.0 skill copies (`implement`, `review`, …) stay in place until then, so units already running keep working; `norn uninstall` removes them.

## [0.1.0] - 2026-10-25

The first release. norn v1 as specified in `.agents/PRD.md`.

### Added

- The `norn` CLI: `init`, `uninstall`, `doctor`, `sync`, `tick`, `watch`, `brief`, `done`, `ask`, `stuck`, `hook`, `inbox`, `answer`, `approve`, `unstick`, `mode`, `workflow`, `take`, `release`, `drop`, `status`, `trace`, `why`, `tidy`, and `norn --version`.
- Workflows as JSON/YAML data, with `story`, `slice` and `bug` templates; a pure decide over observed facts, receipts before effects and `state.json` as the commit point.
- Remotes: GitHub (`gh`) and GitLab (`glab`). Claims and the mailbox live in git refs, so a team can hand a story over at any commit.
- Runners: `herdr` and `headless`. Agents: Claude Code, Codex, OpenCode and Gemini.
- Manual and auto mode per story. Auto mode recovers from crashes: claim renewal, lost launches re-sent, nudges delivered, agent prompts answered from the inbox (R1–R10).
- Base sync: story branches stay in sync with their base, and norn never commits through an agent's merge (BS0–BS11).
- QA outcomes gated on per-criterion verdicts (`norn done --criteria`), and notes for a person (QV1–QV8, NT1–NT4).
- `norn brief` prints the briefing as markdown for the agent; `--json` keeps the machine contract (B2, B3).
- Claude sessions run with `--permission-mode auto` by default.
- Observability: `norn trace` and `norn why` replay any tick exactly.
- The Claude Code plugin (`plugins/claude-code`): the norn skills and a `/norn` command.
- Distribution: an npm package on GitHub Packages and single-file binaries for macOS and Linux (arm64, x64).

[Unreleased]: https://github.com/PruszynskiJakub/norn-next/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/PruszynskiJakub/norn-next/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/PruszynskiJakub/norn-next/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/PruszynskiJakub/norn-next/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/PruszynskiJakub/norn-next/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/PruszynskiJakub/norn-next/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/PruszynskiJakub/norn-next/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/PruszynskiJakub/norn-next/releases/tag/v0.1.0
