---
id: gh-75
slug: regroup-the-cli-around-status-story-and
provider: gh
number: 75
url: https://github.com/PruszynskiJakub/norn-next/issues/75
title: Regroup the CLI around status, story and run, modelled on gh
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:story
workflow: story
status: active
intake_at: 2026-10-28T08:50:06.913Z
body_hash: 59e0017417215f20d7c84bfcd35d4145fa644d1bcbad6f876e80e737d54021d0
---

# Regroup the CLI around status, story and run, modelled on gh

## Problem

Everyone who drives norn — a person at the terminal, a newcomer, a teammate taking a story over, and an agent reading the commands norn prints — meets 29 flat commands in `norn help`, and has to find their way through them each time something needs doing.

- **Five overlapping views:** `status`, `inbox`, `cockpit`, `orient`, `trace`; `status <key>` and `orient` both show one story.
- **Flags that change what a command does:** `approve --reject`, `unstick --to`, `orient --open`, `cockpit --next`, `workflow --to`.
- **Names that mislead:** `drop` sounds local and reversible but cancels the story (GR7); `update` sounds like a self-update but re-enters the base update (BS9); `release` collides with shipping a version; `open` sounds like a view but starts a step.
- **One verb, three jobs:** `unstick` resumes, retries, and moves to another step.
- **Missing actions:** no way to create a story (only a labelled issue plus `sync`), stop a running agent (only `drop`, which cancels the story), undo a drop, or set a config value.

The result is chaos: people and agents find their way by reading help or copying printed commands rather than by guessing, the wrong command (a `drop` meant as "stop") is easy to pick, and every new capability adds another flat command, which makes the surface hard to maintain in the long run.

## Solution

A command surface modelled on gh: nouns are things the person can see, verbs are shared across nouns and borrowed from gh where gh has the same action.

- `norn status` — what needs you, across every story (absorbs `inbox` and `cockpit`).
- `norn story <verb> [<story|slice>]` — general: `create`, `list`, `view`; decision: `answer`, `approve`, `reject`, `update-branch`; work: `start`, `chat`, `edit`; team: `checkout`, `handoff`, `close`, `reopen`.
- `norn run <verb> [<run|unit>]` — `list`, `view`, `attach`, `rerun`, `cancel`.
- Setup: `init`, `doctor`, `config list|get|set|unset`, `uninstall`. Background: `watch`, `sync`, `tidy`. Agent protocol unchanged: `brief`, `done`, `ask`, `stuck`. Only in `help --all`: `tick`, `hook`, `status --segment`.

The target defaults to the unit of the current worktree; at a terminal a missing target prompts with only the units the verb applies to. Old names are removed in the same release, with no aliases. The noun stays `story` until #74 settles it.

### Map from today's commands

| Today | New |
|---|---|
| `status` | `story list` |
| `status <key>`, `orient` | `story view` |
| `status --segment` | unchanged, only in `help --all` |
| `inbox [--details --notes --history]` | `status [same flags]` |
| `cockpit [--interval]`, `cockpit --json` | `status --watch [--interval]`, `status --json` |
| `cockpit --open` | `status --watch --pane` |
| `cockpit --next` | `run attach --next` |
| `orient --open` | `story chat` |
| `open [--print]` | `story start [--print]` |
| `answer` | `story answer` |
| `approve` / `approve --reject` | `story approve` / `story reject --reason` |
| `update` | `story update-branch` |
| `mode auto\|manual` | `story edit --auto\|--manual` |
| `workflow <unit> <name> [--to]` | `story edit --workflow <name> [--at]` |
| `take [--force]` | `story checkout [--force]` |
| `release` | `story handoff` |
| `drop` | `story close` |
| `trace [flags]` | `run list [flags]` |
| `why [flags]`, `why --receipt` | `run view --why [flags]`, `run view --receipt` |
| `unstick [--reset --reason]` | `run rerun [same]` |
| `unstick --to <step>` | `run rerun --step <step>` |
| `config [<key>]` | `config list` / `config get <key>` |
| none | `story create`, `story reopen`, `run cancel`, `config set`, `config unset` |

## Behaviour

### Help and the shape of the surface

- B1 As a person, I want `norn help` grouped into tiers, so that I see the three core nouns first.
  Example: `norn help` → sections **Core** (`status`, `story`, `run`, each with a one-line summary; `story` names its verbs), **Setup** (`init`, `doctor`, `config`, `uninstall`), **Background** (`watch`, `sync`, `tidy`), **Agent protocol** (`brief`, `done`, `ask`, `stuck`), followed by the agent preamble and the skills list as today. `tick` and `hook` are not listed.
- B2 As a person, I want `norn story` with no verb (and `norn help story`) to list its verbs grouped as general, decision, work, team, so that I can find a verb by what I want to do.
  Example: `norn story` → general: `create`, `list`, `view`; decision: `answer`, `approve`, `reject`, `update-branch`; work: `start`, `chat`, `edit`; team: `checkout`, `handoff`, `close`, `reopen`; exit 0. `norn run` does the same for `list`, `view`, `attach`, `rerun`, `cancel`.
- B3 As a maintainer, I want `norn help --all` to add the commands people never type, so that they stay discoverable without cluttering help.
  Example: `norn help --all` → everything in B1 plus `tick`, `hook` and `status --segment`.
- B4 As a person, I want `norn help <noun> <verb>` (and `--help` on any verb) to show that verb's usage, so that I need not read the whole tree.
  Example: `norn help story reject` → usage `norn story reject [<story|slice>] --reason "…"` and its options.
- B5 As a person who types an old command name, I want it treated like any unknown command, so that there is one surface and no hidden second one.
  Example: `norn drop gh-12` → usage error (exit 2) "Unknown command: drop", do_instead pointing at `norn help`; nothing is dropped. The same holds for `inbox`, `cockpit`, `orient`, `open`, `answer`, `approve`, `unstick`, `update`, `mode`, `workflow`, `take`, `release`, `trace`, `why`.
- B6 As a person or agent, I want every `list` and `view` verb to take `--json`, so that scripts read data, never prose (P8).
  Example: `norn story list --json` → one JSON value, the same shape `norn status --json` printed before this change.
- B7 As an agent, I want every command norn prints for a person or an agent — inbox and status items, `do_instead` hints, handoff headers, briefs, cockpit actions, the `doctor`/`init` next steps — to use the new names, so that copying a printed command always works.
  Example: a unit waiting at a gate shows `norn story approve gh-12` under Approve; a stuck unit shows `norn run rerun gh-12`; no printed command names an old verb.
- B8 As a maintainer, I want the docs and the Herdr plugin to use the new names in the same release, so that nothing shipped refers to a removed command.
  Example: the README, CONTRIBUTING, the bundled and repo-local skills, AGENTS.md and the Herdr plugin actions (next, pick, cockpit, open) all call the new commands; the plugin's cockpit action runs `norn status --watch --pane`.

### `norn status`

- B9 As a person, I want `norn status` to show what needs me across every story, grouped by action as the inbox is today (O1), so that one word answers "what now?".
  Example: one unit at a gate, one parked on a question → `norn status` prints the Approve and Answer groups with each item's age and the command to resolve it; with nothing to do it prints the empty inbox as `norn inbox` did.
- B10 As a person, I want `--details`, `--notes`, `--history [--since]` and `--json` on `status` to behave as they did on `inbox`, so that nothing is lost in the move.
  Example: `norn status --history --since 1d` → the same output `norn inbox --history --since 1d` gave.
- B11 As a person, I want `norn status --watch` to open the live cockpit full screen, so that I keep a view that updates and lets me act by key.
  Example: `norn status --watch` → the cockpit (what needs you, every story, the selected row's preview, actions by key) until q or Esc; `--interval 5s` sets the refresh as `cockpit --interval` did; the actions it offers run the new commands.
- B12 As a person inside Herdr, I want `norn status --watch --pane` (listed in help) to split a pane below mine and run the cockpit there, so that I can open it without the plugin's key binding.
  Example: in a Herdr pane → a new pane below runs the cockpit; outside Herdr → refused with the reason and do_instead `norn status --watch`.
- B13 As a person who used `norn status` to list stories, I want a one-time notice the first time I run `norn status` on a checkout after upgrading, so that I learn where the listing went.
  Example: first `norn status` after the upgrade → stderr: "`norn status` now shows what needs you; the story listing moved to `norn story list`." Second run on the same checkout → no notice. stdout and `--json` output are unaffected.
- B14 As Herdr, I want `norn status --segment` to keep printing the tab bar line and its sidebar presentation exactly as today, so that the integration keeps working.
  Example: `norn status --segment` → the same line as before this change.

### `norn story` — general

- B15 As a person, I want `norn story list` to show stories, slices, runs and claims at a glance, as `norn status` did, so that the overview has a name that says what it lists.
  Example: `norn story list` → the table `norn status` printed before; `--json` gives its JSON shape unchanged.
- B16 As a person, I want `norn story view [<story|slice>]` to show one story — slices, PR, open notes, what waits for me — merging what `status <key>` and `orient` showed, so that there is one view per story.
  Example: `norn story view gh-12` → the story's slices with their steps, the PR link and state, open notes and items waiting for the person.
- B17 As a person, I want `norn story view --web` to open the story's PR in the browser, or its issue when there is no PR, so that I can jump to the remote.
  Example: gh-12 with PR #40 → opens PR #40; gh-13 without a PR → opens issue #13.
- B18 As a person, I want `norn story create --title "…" [--body "…" | --body-file <f>] [--workflow <name>]` to create the issue on the remote with the `norn` label, assigned to me, and take it in at once, so that I can start a story without leaving the terminal.
  Example: `norn story create --title "Fix login timeout" --workflow fix` → the remote issue #81 is created with labels `norn` and `norn:wf:fix`, assigned to me; an intake sync runs; prints `gh-81`. The story is taken in like a hand-made labelled issue (GR1) and is not started: it shows in `norn status` as any new story does.
- B19 As a person at a terminal, I want `norn story create` without `--title` to prompt for the title and open `$EDITOR` for the body, so that it feels like `gh issue create`.
  Example: `norn story create` → prompt "Title:", then the editor; empty title → nothing is created, exit 2.
- B20 As a script, I want `norn story create` without `--title` under `--json` or with no TTY to be refused, so that it never waits for input.
  Example: `norn story create --json` → usage error (exit 2), do_instead "pass --title".
- B21 As a person, I want an unknown `--workflow` refused before anything is created, so that no issue is left half set up.
  Example: `norn story create --title x --workflow nope` → refused (exit 3) listing the available workflows; no remote issue exists.
- B22 As a person, I want a remote or auth failure during `story create` to leave nothing behind locally and say what to fix, so that I can retry cleanly.
  Example: offline → error naming the remote failure, do_instead `norn doctor`; no story is taken in.
- B23 As a person, I want `norn story create --web` to open the remote's new-issue page with the `norn` label (and workflow label, if given) filled in, so that I can write the issue in the browser.
  Example: `norn story create --web --workflow spec` → the browser opens the new-issue page with labels `norn`, `norn:wf:spec`.

### `norn story` — decision

- B24 As a person, I want `norn story answer [<unit>] …` to answer the question a unit is parked on, as `norn answer` did, so that answering lives with the story.
  Example: gh-12 parked on a question → `norn story answer gh-12 "Use the v2 API"` delivers the answer as `norn answer` did.
- B25 As a person, I want `norn story approve [<unit>]` to approve the gate a unit waits at, as `norn approve` did, so that approving keeps its meaning.
  Example: gh-12 at the ready gate → `norn story approve gh-12` writes the approve receipt; the next tick moves on.
- B26 As a person, I want `norn story reject [<unit>] --reason "…"` to reject a gate, with the reason required, so that the next attempt knows why.
  Example: `norn story reject gh-12 --reason "misses B4"` → reject receipt with that comment; `norn story reject gh-12` without `--reason` → usage error (exit 2), do_instead "pass --reason".
- B27 As a person, I want `norn story update-branch [<story>]` to send a waiting story back through its base update, as `norn update` did (BS9), with the same conditions and refusals.
  Example: gh-12 done with an unmerged PR, held here → `norn story update-branch gh-12` re-enters the base update step; a story not in one of the BS9 states → refused with the same do_instead as before.

### `norn story` — work

- B28 As a person, I want `norn story start [<unit>] [--print]` to open an agent on a step a person starts, as `norn open` did (MO5), so that starting reads as starting.
  Example: gh-12 at an attended step → a Herdr tab in its worktree running the start command; `--print` prints the command instead.
- B29 As a person, I want `norn story chat [<story>]` to give a story its own Herdr workspace with an agent, as `orient --open` did, so that talking about a story has its own verb.
  Example: `norn story chat gh-12` → opens or focuses the `gh-12 orient` workspace with an agent.
- B30 As a person, I want `norn story edit [<story>] --auto|--manual` to switch a story's mode, as `norn mode` did.
  Example: `norn story edit gh-12 --auto` → mode receipt; the next tick runs gh-12 in auto. `--auto --manual` together → usage error (exit 2).
- B31 As a person, I want `norn story edit [<unit>] --workflow <name>` to choose a unit's workflow before it starts, as `norn workflow` did.
  Example: gh-13 not started → `norn story edit gh-13 --workflow fix` sets its workflow.
- B32 As a person, I want switching the workflow of a started unit to need `--at <step>` (S7), so that the step it lands on is always explicit.
  Example: gh-12 started → `norn story edit gh-12 --workflow quick --at implement` switches it, journaled as `workflow --to` was; without `--at` → refused with do_instead naming `--at`.

### `norn story` — team

- B33 As a person, I want `norn story checkout [<story>] [--force]` to take a story over on this machine, as `norn take` did.
  Example: `norn story checkout gh-12` → claims it, checks out its branches, prints the handoff; another machine's live claim → refused unless `--force`, as before.
- B34 As a person, I want `norn story handoff [<story>]` to hand a story over, as `norn release` did: push branches and handoff, then delete the claim.
  Example: `norn story handoff gh-12` → branches pushed, claim gone; another machine can `story checkout` it.
- B35 As a person, I want `norn story close [<story>]` to have `drop`'s effects — push the branches, then remove the worktrees, local branches and the claim, keeping the record — and leave the remote issue and PR alone (GR7).
  Example: `norn story close gh-12 --yes` → branches pushed; worktrees and local branches gone; claim deleted; issue #12 still open.
- B36 As a person at a terminal, I want `story close` to ask before it removes worktrees, so that I do not close by accident.
  Example: `norn story close gh-12` → "Close gh-12? Worktrees for 3 units will be removed [y/N]"; N → nothing changes, exit 0.
- B37 As a script, I want `story close` without `--yes` under `--json` or with no TTY to be refused, so that it never closes without consent.
  Example: `norn story close gh-12 --json` → refused (exit 3), do_instead "pass --yes".
- B38 As a person, I want `story close` on a story another machine holds to be refused, so that I do not tear down someone else's work.
  Example: claim held by `ann@laptop` → refused (exit 3), do_instead `norn story checkout gh-12` first.
- B39 As a person, I want closing a story that is already closed to be refused, so that the second close is harmless.
  Example: `norn story close gh-12 --yes` twice → second is refused `already_closed` (exit 3); nothing changes.
- B40 As a person, I want `norn story reopen [<story>]` to undo a close: re-claim the story here, re-create its worktrees from the pushed branches and put each unit back at the step it was at, so that a close is not final.
  Example: gh-12 closed while slice 2 was at `review` → `norn story reopen gh-12` → worktrees back, claim held here, slice 2 at `review`.
- B41 As a person, I want a unit that was running when the story was closed to come back parked, so that nothing starts by itself after a reopen.
  Example: slice 3 was running `implement` at close → after reopen it is parked with reason `reopened` under Unblock; `norn run rerun` resumes it.
- B42 As a person, I want `story reopen` refused when it cannot restore the story, with the reason.
  Example: gh-12 not closed → refused `not_closed`; its branch gone from the remote → refused naming the branch; issue #12 closed → refused, do_instead "reopen the issue first" (GR7 would park it anyway). All exit 3.

### `norn run`

- B43 As a person, I want `norn run list [<unit>]` to show the step timeline, as `norn trace` did, with the same flags.
  Example: `norn run list gh-12` → steps with durations, outcomes, who, reasons; a story with its slices.
- B44 As a person, I want `norn run view [<run|unit>]` to show one run — step, attempt, outcome, durations, receipts — and a unit key to mean its latest run.
  Example: `norn run view gh-12-s2` → the latest run of slice 2; `norn run view 01M60…` → that run.
- B45 As a person, I want `norn run view --why` and `--receipt <id>` to do what `norn why` and `why --receipt` did (O5).
  Example: `norn run view gh-12 --why` → replays decide on the recorded tick and shows the rule that fired.
- B46 As a person, I want `norn run attach [<unit>]` to focus the agent pane of a unit's live run.
  Example: `norn run attach gh-12-s2` → focuses its Herdr pane; a unit with no live pane → refused `nothing_to_attach`, giving the unit's start command when it has one.
- B47 As the Herdr plugin, I want `norn run attach --next` to focus the agent pane of the oldest Your turn unit without prompting, as `cockpit --next` did (HC10).
  Example: two Your turn units → focuses the older one; none → refused `nothing_to_attach`.
- B48 As a person, I want `norn run rerun [<unit>] [--reset <counter>] [--reason]` to resume a stuck, parked or gate-waiting unit at its step, as `norn unstick` did.
  Example: gh-12 stuck at `implement` → `norn run rerun gh-12` → resumes `implement` in a fresh session.
- B49 As a person, I want `norn run rerun --step <step>` to move a unit to another step of the same workflow, as `unstick --to` did.
  Example: gh-12 stuck at `qa` → `norn run rerun gh-12 --step implement` → the unit moves to `implement`.
- B50 As a person, I want `run rerun` on a running unit to be refused, so that stopping an agent is always a separate, explicit act.
  Example: gh-12 running `implement` → refused (exit 3), do_instead `norn run cancel gh-12` first.
- B51 As a person, I want `norn run cancel [<unit>]` to stop a unit's running agent session without cancelling the story, so that I can stop an agent that went wrong.
  Example: gh-12 running `implement` → the session is stopped; a receipt is written first (P6); the unit parks with reason `cancelled by person` under Unblock; the next tick does not restart it.
- B52 As a person, I want `run cancel` to keep everything else, so that no work is lost.
  Example: after `norn run cancel gh-12` → commits, uncommitted changes in the worktree, the branch, the claim and the Herdr pane are all still there; `norn run rerun gh-12` resumes `implement` in a fresh session, `--step` moves it, `norn story close` ends the story.
- B53 As a person, I want `run cancel` refused when there is nothing to cancel or I do not hold the claim.
  Example: gh-12 waiting at a gate → refused `nothing_to_cancel`; claim held by another machine → refused, do_instead `norn story checkout gh-12` first. Both exit 3.

### Targets and prompts

- B54 As a person in a unit worktree, I want a verb without a target to act on that worktree's unit, so that I do not retype the key I am standing in.
  Example: in the gh-12 slice 2 worktree, `norn story approve` → approves slice 2's gate.
- B55 As a person in a slice worktree, I want story-only verbs (`close`, `reopen`, `handoff`, `update-branch`, `chat`, `view`, `edit --auto|--manual`) to act on the slice's story.
  Example: in the gh-12 slice 2 worktree, `norn story handoff` → hands over gh-12.
- B56 As a person, I want an explicit target to win over the worktree, so that I can act on any unit from anywhere.
  Example: in the gh-12 worktree, `norn story approve gh-14` → approves gh-14.
- B57 As a person at a terminal outside a unit worktree, I want a verb without a target to prompt with only the units it applies to, in `norn status` order, so that I pick from what makes sense.
  Example: `norn story approve` in the main checkout with gh-12 and gh-14 at gates → a pick-list of gh-12 and gh-14 only.
- B58 As a person, I want the prompt shown even when only one unit applies, with it preselected, so that I never act on a unit I did not see.
  Example: only gh-12 at a gate → the pick-list shows gh-12 preselected; Enter approves it.
- B59 As a person, I want a verb with no applicable unit to refuse with the reason instead of prompting.
  Example: `norn story approve` with nothing at a gate → refused (exit 3) "Nothing waits at a gate".
- B60 As a script or an agent, I want a missing target under `--json`, with no TTY, or in an agent session to be refused, never prompted, with the candidates listed.
  Example: `norn story approve --json` in the main checkout → `CliError` (exit 2), do_instead naming `gh-12` and `gh-14`.

### `norn config`

- B61 As a person, I want `norn config list` and `norn config get <key>` to show the resolved configuration as `norn config` and `norn config <key>` did (K2a).
  Example: `norn config get default_mode` → its value and the layer that set it.
- B62 As a person, I want `norn config set <key> <value> --user|--repo` to write one value into the user or repo config file, so that I need not edit YAML by hand.
  Example: `norn config set default_mode auto --user` → `~/.norn/config.yaml` gains `default_mode: auto`; `norn config get default_mode` shows it from the user layer.
- B63 As a person, I want dotted keys and YAML values, with lists set whole, so that nested settings are reachable.
  Example: `norn config set agents.claude.model opus --repo`; `norn config set limits.deadline 90m --repo`; `norn config set notifiers '[{adapter: os}]' --user`.
- B64 As a person at a terminal, I want `config set` without `--user`/`--repo` to ask which file, so that a personal setting does not land in the team's committed file by accident.
  Example: `norn config set default_mode auto` → "Write to user (~/.norn/config.yaml) or repo (.agents/norn/config.yaml)?".
- B65 As a script, I want `config set` without a file flag under `--json` or with no TTY to be refused.
  Example: `norn config set default_mode auto --json` → usage error (exit 2), do_instead "pass --user or --repo".
- B66 As a person, I want an unknown key or an invalid value refused with the file left unchanged.
  Example: `norn config set slots.max lots --repo` → refused naming the validation error; the repo file is byte-for-byte the same.
- B67 As a person, I want `config set` to keep the file's comments and key order, so that my notes survive.
  Example: a commented repo file → after `config set`, only the changed line differs.
- B68 As a person, I want `norn config unset <key> --user|--repo` to remove a value from that file, with the same file-flag rules as `set`.
  Example: `norn config unset default_mode --user` → the key is gone from the user file; `config get default_mode` shows the next layer's value. Unsetting a key the file does not have → nothing changes, exit 0.

### What stays

- B69 As an agent, I want `brief`, `done`, `ask`, `stuck` and `hook` unchanged, so that running sessions, installed hook configs and skill copies keep working across the upgrade.
  Example: a session started before the upgrade reports with `norn done approve` after it → accepted as before.
- B70 As a maintainer, I want receipt kinds, `state.json`, trace events, exit codes, the `CliError` shape and the `--json` shapes of moved commands unchanged, so that existing units, traces and scripts that parse JSON keep working.
  Example: a unit mid-workflow before the upgrade continues after it with no migration; `norn run list --json` prints what `norn trace --json` did.
- B71 As a maintainer, I want the PRD's command table (§15) rewritten as the noun tree, and every rule that names an old command (O1, O2, O5, MO5, S7, BS9, GR7, K2a, HC4–HC13, …) to name the new one, so that the spec and the CLI agree.
  Example: S7 reads "through `norn story edit <unit> --workflow <name> --at <step>`".

## Out of scope

- User-defined aliases (`gh alias set`) — not now.
- Renaming the noun "story" — #74, which brings its own CLI rename.
- Three config files and key moves — #64, to be rewritten on top of `config set`/`unset`.
- Shell completion — a later story; the noun tree makes it easy.
- Aliases or a deprecation period for old names — dropped by decision; old names are plain unknown commands (B5).
- Changes to the agent protocol, `hook`, receipt kinds, `state.json`, trace events, exit codes, `CliError`, or the `--json` shapes of moved commands — they stay (B69, B70).
- New views or changes to the inbox grouping (O1) — `status` shows what `inbox` and `cockpit` show today.
- `--repo`/`-R` to act on another repository — not now.

## Open questions

None.

## Related

- #74 renames the core noun "story"; until it lands the noun is `story`.
- #64 (minimal config) is to be rewritten to build on `config set`/`unset` as specified here.
