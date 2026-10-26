# Spec: herdr cockpit (norn v1.2)

Status: draft for review · Amends `.agents/PRD.md` (MO4, O1, O3, X1) · Branch `herdr-cockpit`

## 1. Why

The todoist-app dogfood run (2026-10-25) showed three gaps when norn runs inside Herdr:

1. **An attended agent waiting for you is invisible.** Once `norn brief` starts an attended run (refine, clarify, plan), the inbox shows `running: refine #1 (manual)` until the agent reports. MO4 assumes the person sits in the agent's pane, so every turn end means "waiting for you". With several Herdr workspaces open, the refine interview sat on a question unnoticed while a second agent was started for the same step.
2. **The status pane only reads.** `norn pane` redraws the inbox, but every item still means copying a command into another pane: answering, approving, taking, or finding the pane an agent runs in.
3. **Herdr cannot tell a norn agent from any other.** Its sidebar shows `claude idle` for the refine agent and for an unrelated session alike.

Herdr (≥ 0.9) has what is needed: plugin manifests with panes, key-bindable actions and link handlers; `herdr agent list` with each agent's session id; `herdr agent focus`; `herdr pane report-metadata` (title and per-status labels with a TTL); and `herdr notification show`.

## 2. Goals and non-goals

Goals:
- The inbox says when an attended agent waits for its person, and where (HC1–HC3).
- `norn pane --interactive` lets a person act on inbox items with one line each, through CLI verbs only (HC4–HC8).
- A Herdr plugin shipped with norn opens that pane and jumps to the oldest item waiting for you (HC9–HC11).
- While the cockpit runs, agent panes of norn runs carry the unit and step in Herdr's sidebar (HC12–HC13).
- Notifications can be Herdr toasts (HC14).
- The cockpit jumps to the Herdr workspace of an item's run, even when no agent runs there (HC15).

Non-goals:
- A full-screen TUI (raw-mode keys, mouse). The cockpit stays line-based, like the Herdr GitHub Issues plugin.
- Linking the plugin from `norn init`. Installing it is one `herdr plugin install` (HC11).
- Changing what an attended step is: no `silent`, nudge, deadline or implicit `ask` for attended steps (MO4 stays).

## 3. Part A — attended wait (amends MO4, O1)

- HC1 An attended run **waits for its person** when all hold:
  - the unit is `running` an attended agent step, and the run observed is the unit's current run;
  - the run is not dead (process and pane not seen gone);
  - the run's newest hooks, after its last `turn_start` / `tool_use`, are `turn_end`, `waiting_input` or `permission_prompt` — or, with no such hook, its runner pane is `idle`, `done` or `waiting_input` since after the last hook.

  The wait starts at the first of those trailing hooks (or the pane's state change). Claude's `idle_prompt` notification (`turn_end`, ~60 s after `Stop`) therefore does not restart it.
- HC2 After `limits.attended_wait` (default `2m`; `0s` = at once) of waiting, the inbox shows the unit under **Your turn**: `<step>: the agent is waiting for you`, instead of under Running. Its `since` is the wait start, and its id is `attended:<unit>:<run_id>:<wait start>`, so the notifiers (O3) fire once per wait, and a new turn followed by a new wait is a new item. The delay keeps a live back-and-forth from notifying.
- HC3 The item's command is how to reach the session: the runner's reach command when the run has a runner session, else `cd <worktree>`. Never the start-agent command (a second agent for the step was the dogfood mistake). Every inbox item of a unit with a current run also carries `reach: {worktree, agent_session_id, pane_id}` (nulls when unknown) so front ends can find the agent's pane (HC6).

MO4 gains one sentence: *an attended run waiting for its person is shown as Your turn (HC1–HC2); this records no outcome.*

## 4. Part B — interactive cockpit (amends O1, X1)

- HC4 `norn pane --interactive` draws its own frame of the inbox (not `formatInbox`): a header with the repo, how many items need you, the heartbeat and the time; the groups in O1 order, each item one row — number, unit, step, title (cut to the pane width, the step not repeated), age — with its command dimmed beneath; colour per group on a terminal (off with `NO_COLOR`, `TERM=dumb` or when stderr is not a terminal). It reads one command per line from stdin between redraws. The frame and messages go to stderr, the JSON summary to stdout at exit (P8), as today. It ends on `q`, end of input, SIGINT or SIGTERM.
- HC5 Commands (`<n>` is an item number in the current frame):

  | Line | Does |
  |---|---|
  | `<n>` or `g <n>` | go to the item: focus the agent pane of its run (HC6); for a manual start (`… is ready (manual)`, attended step not started) run `norn open <unit>` when the item shows it (MO5), else open a pane beside the cockpit and run the item's command there; else focus the workspace of its run (HC15); otherwise show the command |
  | `w <n>` | focus the Herdr workspace of the item's run (HC15) |
  | `a <n> <text>` | `norn answer <unit> <text>` |
  | `y <n>` | `norn approve <unit>` |
  | `x <n> <reason>` | `norn approve <unit> --reject --reason <reason>` |
  | `t <n>` | `norn take <story>` |
  | `u <n>` | `norn unstick <unit>` |
  | `v <n>` | `norn trace <unit>` (its markdown) into the frame |
  | `d <n>` | the item's full text (title, detail, full screen, command, link), wrapped to the width |
  | `o` | open or close Notes (HC16) |
  | `n` | go to the oldest Your turn item with a run (an agent waits there), else the oldest Your turn item |
  | `r` / empty | redraw now |
  | `?` | list every command, one per line |
  | `q` | quit |

  A command that does not fit the item (approving an Answer item, a number not in the frame) is refused with a message; nothing runs.
- HC6 The agent pane of a run is found through the runner, never stored: the run's `session.pane_id` when the runner is Herdr; else the Herdr agent whose session id is the run's `agent_session_id`; else the one Herdr agent whose working directory is the unit worktree. Several candidates → none (the cockpit says so instead of guessing).
- HC7 Verbs run in-process through the CLI dispatcher (`runCli`) with the cockpit's cwd and env. Their JSON outcome is shown as one message line: `ok` with the verb's main field, or the `CliError` `error` and `do_instead`. X1 holds: the cockpit reads through `@norn/view` and writes only through CLI verbs.
- HC8 Without Herdr (no `HERDR_ENV=1`), `g` and `w` only show the command, `n` jumps nowhere, and labels (HC12) are off; the other verbs work.

## 5. Part C — Herdr plugin

- HC9 norn ships a Herdr plugin at `plugins/herdr/` (id `norn`): a `cockpit` pane entrypoint running `norn pane --interactive`; an `open` action that opens it as a split below the focused pane without taking focus; a `next` action that focuses the agent pane of the oldest Your turn item with a run (`norn pane --next`) or shows a toast when there is none.
- HC10 `norn pane --next` is a one-shot: it builds the view once, takes the oldest Your turn item **with a run** (manual starts are skipped: it never starts an agent), focuses its agent pane (HC6), prints `{focused: <pane_id> | null, item: <id> | null}` (plus the item's `command` when no pane was found) and exits 0 either way. `norn pane --open` opens the cockpit pane with `--interactive`.
- HC11 The plugin's commands call `$NORN_BIN` when set, else `norn` from `PATH`, else the launch shim `~/.norn/bin/norn`. The plugin ships in the repo, not in the package or binary, so the README documents `herdr plugin install PruszynskiJakub/norn-next/plugins/herdr` (or `herdr plugin link <checkout>/plugins/herdr` from a checkout), and the actions `norn.open` and `norn.next`. `norn doctor` reports under `runner.cockpit_plugin`, informationally (never failing doctor), whether the plugin is linked when Herdr is the runner; when it is not, `do_instead` is `herdr plugin link` with this checkout's `plugins/herdr` when norn runs from source, else `herdr plugin install`.

## 6. Part D — pane labels

- HC12 On each redraw, the cockpit labels the agent pane of every item whose run it finds (HC6) with `herdr pane report-metadata <pane> --source norn`: title `<unit> · <step>`, and, for every Herdr status, the item's group as norn sees it — `norn: your turn`, `norn: answer` or `norn: unblock`; a Running item gets the title only. The first item per pane wins (group order). The TTL is 3 × the redraw interval, so labels disappear soon after the cockpit stops. No label is written for a pane norn cannot attribute.
- HC13 Labels are presentation only: they are not facts, decide never reads them, and a failed label write is ignored. Only the cockpit writes them; `tick` stays free of presentation (P2).

## 7. Part E — Herdr notifier (amends O3)

- HC14 Notifier adapter `herdr` shows each new inbox item as `herdr notification show <title> --body <body>`, with sound `request` for Your turn, Answer and Approve and `none` otherwise. It needs `HERDR_ENV=1` or a reachable Herdr socket. Outside Herdr it fails with `unsupported`, and the other configured notifiers still run. Opt in with `notifiers: [{adapter: os}, {adapter: herdr}]`.

## 8. Part F — workspaces

- HC15 The workspace of a run is found through Herdr, like its pane (HC6), never stored: the workspace holding the run's recorded pane, else the one workspace with a pane (foreground working directory, else the pane's) in the unit worktree. Several candidates → none, and the cockpit says so. `w <n>` focuses it with `herdr workspace focus`; an item without a run (an unclaimed story, a manual start) has no workspace to find, and `w` says so with the item's command. `g` uses it when the run has no agent pane to focus (an approval after the agent ended, a stuck unit), before falling back to the command. Workspace labels are not used: they change with the step and a person may rename them.

## 8a. Part G — Notes as an accordion

- HC16 The cockpit draws Notes collapsed: one header line, `▸ NOTES <count> · <n> new  … · o to open`, and no rows, so notes take no numbers and the items below them keep low ones. `o` opens Notes (`▾ NOTES <count> … · o to close`) and closes them again. Open, the notes are numbered like any item (`d <n>` shows one in full) and grouped by unit: the unit with the newest note first, each unit's notes in the order they were left. A note is new when it was left after the newest note seen while Notes were open; that time is kept on this checkout in `.agents/norn/trace/cockpit.json` (`notes_seen_at`), never committed, so opening Notes marks every note shown as seen. Read only: notes cannot be cleared or answered here (NT3 still clears them).

## 9. Contract changes

- `ResolvedConfig.limits.attended_wait` (Duration, default `2m`); schema re-emitted.
- `InboxItem.reach?` (core ports); not part of `InboxChange` (trace).
- `norn pane` gains `--interactive` and `--next`; `--open` opens the interactive cockpit.
- `@norn/adapters` `herdr`: `listAgents`, `focusPane`, `labelPane`, `openCommandPane`, `listWorkspaces`, `focusWorkspace`, `findWorkspace`; `notify`: `herdr` notifier.
- New `plugins/herdr/` (manifest and scripts), covered by `test/repo.test.ts`'s glossary lint like `plugins/`.

## 10. Tests

- Core: HC1/HC2 waiting detection (trailing hooks, pane fallback, `idle_prompt` not restarting, the delay, a new turn making a new id), HC3 command and `reach`.
- CLI: the cockpit command parser and argv for each verb (HC5); a scripted cockpit session against a fake view and fake Herdr (go, answer, refusal, quit); `--next` with and without a waiting item.
- Adapters: recorded `herdr agent list` / `workspace list` / `pane list` / `pane report-metadata` / `notification show` argv and outputs; pane and workspace lookup (HC6, HC15), including the ambiguous case.
- Repo: the plugin manifest parses and names only scripts that exist.
