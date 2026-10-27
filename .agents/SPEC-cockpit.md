# Spec: one cockpit (norn v0.9)

Status: draft for review · Amends `.agents/SPEC-herdr-cockpit.md` (HC4, HC5, HC8, HC9, HC10, HC16) and PRD O1, X1 · Branch `cockpit-unify`

## 1. Why

0.8.0 shipped two cockpits. `norn pane --interactive` reads one typed line per command (`y 3`, `a 2 CSV only`). `norn pick` takes raw keys in a Herdr popup. Each decides on its own which actions fit which item (`planCockpit`, `pickKey`). The person testing them on todoist-app wants one, the picker's look, and a web panel later that behaves the same.

So the cockpit is split in two:
- a **model**: pure, in `@norn/view`. It holds the rows and the actions each row offers, as data.
- **renderers**: the terminal now, a web panel later. A renderer maps the model's actions to keys or buttons. It never decides which actions fit a row.

Writes stay CLI verbs (X1).

This spec also gives ids to what 0.8.0 shipped without them: `norn orient` (OR1–OR4) and `norn status --segment` (SG1–SG3).

## 2. Goals and non-goals

Goals:
- One cockpit command, `norn cockpit`, with the picker's look and the old cockpit's reach (answer, reject, unstick, trace) (CP4–CP9).
- A front-end-neutral cockpit model that a web panel can render without norn logic of its own (CP1–CP3).

Non-goals:
- Building the web panel (§8 says how it would plug in).
- Mouse input.
- Changing what the inbox holds (O1) or any verb.

## 3. The model (amends X1)

- CP1 `cockpitModel(view, capabilities)` in `@norn/view` is pure: a `ProjectView` in, a `CockpitModel` out, no IO and no clock beyond `view.at`.
  - `capabilities` says what the front end can do: `{ places: boolean }`. It is true when the front end can focus an agent's pane and open an orient workspace (the terminal inside Herdr).
  - The model is plain JSON, like `ProjectView`.
- CP2 `CockpitModel` holds:
  - `header`: the repo, how many items need the person (`inbox.pending`) and the heartbeat (`view.heartbeat`).
  - `rows`, in two sections:
    - **needs you**: one row per inbox item of `your_turn`, `answer`, `approve`, `unblock` and `check`, in O1 order;
    - **stories**: one row per story.

    Running, Notes and Recently done items are no rows; the story preview shows them.

  A row has:
  - `id`: the inbox item id, or `story:<key>`;
  - `kind`: `item` or `story`;
  - `group`: for an item;
  - `story`, `unit`, `step`, `title`, `since`, `age`;
  - `preview`: CP3;
  - `actions`: CP4.

  A row's `id` is stable across rebuilds, so a renderer keeps the selection on the same row when the view refreshes.
- CP3 A row's `preview` is the orient report of its story (OR2): standing, slices, PR, what waits, what runs, and the open notes by unit (full text). An item row's preview also has the item's title, detail and command. The preview is data (`OrientReport` plus the item). Each renderer lays it out itself.
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
  | orient | enter | every row | place orient (inside Herdr: `norn orient <story> --open`); without places: verb `orient <story>`, shown |
  | agent | g | an item whose unit has a current run (`reach`) | place agent (HC6, then HC15) |
  | start | s | a Your turn manual start (`norn open <unit>` in its command, MO5) | verb `open <unit>` |
  | answer | a | Answer | input "Your answer" → verb `answer <unit> {input}` |
  | approve | y | Approve | verb `approve <unit>` |
  | reject | x | Approve | input "What to change" → verb `approve <unit> --reject --reason {input}` |
  | unstick | u | an item whose command is `norn unstick …` | verb `unstick <unit>` |
  | take | t | the story row of a story nobody holds (claim `unclaimed`) | verb `take <story>` |
  | trace | v | every row | verb `trace <unit>`, shown |
  | pr | o | every row of a story whose PR is known (`StoryView.pr`) | link to the PR URL |
  | issue | i | every row of a story with an issue URL | link to the issue URL |

  The model alone decides which rows offer which action: a renderer never infers it from groups or commands. An action a row does not offer is absent, not disabled.
- CP5 `norn cockpit --json` prints the model once and exits (P8), so a front end outside TypeScript can read it. Running an action needs no extra entry point: its `argv` is a norn command (`norn <argv…> --json`).

## 4. The terminal cockpit (replaces HC4, HC5, HC8, HC16)

- CP6 `norn cockpit [--interval 5s]` draws the model full screen: the header, a filter line, the rows on the left (the needs-you section, then stories), the selected row's preview on the right (below the rows when the pane is narrower than 100 columns), and a footer. The footer lists the selected row's actions by key, then `/ filter · r refresh · ? help · q quit`.
  - It reads raw keys (a terminal in raw mode, restored on exit).
  - It redraws on every key and every interval, with a fresh view on the interval and after each action.
  - Frames go to stderr, one JSON summary (the last action taken) to stdout at exit (P8).
  - It ends on `q`, Esc with no filter and no prompt open, end of input, SIGINT or SIGTERM.
- CP7 Keys:
  - ↑↓ or `k`/`j` move; PgUp/PgDn move a page.
  - `/` opens the filter: typing narrows the rows to those where every word appears; Enter keeps the filter, Esc clears it.
  - An action's key runs it on the selected row. A key the row does not offer shows `no <action> here`; nothing runs.
  - An action with `input` opens a one-line prompt in the footer, labelled with its `prompt`. Enter submits; Esc cancels. Empty text is refused when `required`.
  - `r` refreshes, `?` lists every key, `q` quits.
- CP8 Every action leaves the cockpit open. Its outcome is one line in the footer: `ok: norn approve gh-1`, or the `CliError` `error` and `do_instead` (HC7), or where a place action went. A shown verb's markdown replaces the preview until the selection moves or Esc is pressed.
  - Effects run as follows: `verb` through the CLI dispatcher in-process (HC7); `link` with the platform opener (`open` on macOS, `xdg-open` on Linux); `place` through the Herdr cockpit adapter.
- CP9 Inside Herdr the cockpit also labels agent panes, as before (HC12, HC13).

## 5. Names, plugin and what goes away (amends HC9, HC10)

- CP10 `norn cockpit` is the only cockpit command; `norn pane` and `norn pick` are removed, with no aliases (pre-1.0, a minor version may change the machine contract). What `norn pane` also did moves:
  - `norn cockpit --next` focuses the agent pane of the oldest Your turn item with a run, as `norn pane --next` did (HC10).
  - `norn cockpit --open` opens the cockpit in a Herdr split below the caller, as `norn pane --open` did.
  - The plain redrawn inbox (`norn pane` without flags, O1 "a Herdr status pane") is dropped: `norn inbox` prints it and the cockpit replaces the pane.
- CP11 The Herdr plugin keeps its ids, and every entry runs `norn cockpit`:
  - `norn.open` and pane `cockpit` show it as a split below the focused pane;
  - `norn.pick` and pane `pick` show it as a popup over it;
  - `norn.next` runs `norn cockpit --next`.
- CP12 Removed:
  - the `norn pane` and `norn pick` commands (CP10);
  - the line commands (HC5's table) and their parser (`parseCockpitLine`, `planCockpit`);
  - `pickKey`'s own action rules;
  - the Notes accordion and its `cockpit.json` marker (HC16): notes live in the preview (CP3), with no "new" count.

## 6. Orient (shipped in 0.8.0)

- OR1 `norn orient <story|unit> [--json]` is read only: no receipt, run or claim. It prints markdown by default and `--json` gives the report (P8).
- OR2 The report (`orientReport` in `@norn/view`) holds:
  - the story's title, issue URL, standing, mode and claim;
  - each slice's standing and last outcome;
  - the worktree, branch and spec path;
  - the PR as last seen, and the `gh pr view <branch>` / `glab mr view <branch>` command (`config.remote.provider`);
  - the inbox items of the story that wait for the person, with their commands, and those running;
  - the open notes, grouped by unit, the unit with the newest note first;
  - where to look: the spec, `norn trace`, `norn why`, `norn status`.

  The markdown opens with rules for an agent: a summary of at most 5 lines that counts the notes, then answers; norn commands that change anything only when the person says so; no code edits, commits or outcomes; notes grouped by topic when asked.
- OR3 `--open`, inside Herdr:
  - It focuses the workspace labelled `<story> orient` that has a pane in the story's root (or no panes).
  - Otherwise it creates that workspace in `StoryView.root` and runs the default agent there, with its configured args, prompt "Run `norn orient <key>` and follow it."
  - The agent runs with `NORN_ORIENT=1` and its own shim `~/.norn/orient/bin/norn`, first on PATH (R8.1).
  - Outside Herdr, `--open` prints the command.
- OR4 With `NORN_ORIENT=1`, `norn hook` records nothing and `brief`, `done`, `ask` and `stuck` refuse with code `orient_session`. An orient session is no run.

## 7. Tab bar segment (shipped in 0.8.0)

- SG1 `norn status --segment [--ttl 30s]` prints one plain line: `norn·<repo>` and, per group that has items, a mark, count and word (`▶ 1 your turn ◆ 1 answer ● 1 approve ✖ 1 stuck ◇ 1 check ◐ 2 running`), or `✓ nothing waits` (with the running count). Herdr runs it (`tab_bar_right`) in the focused pane's directory. Outside a repository it prints an empty line and exits 0.
- SG2 With Herdr reachable (`HERDR_ENV=1` or `HERDR_SOCKET_PATH`):
  - It writes a `norn` token on each orient workspace of the repo, with the TTL: the first waiting group with `+n` for more, else `◐ running`, `✓ done` or `· quiet`.
  - It moves those workspaces, within the slots they hold, so the ones that need the person come first. Other workspaces never move. It makes no move when the order already holds.

  Herdr's `insert_index` is a gap in the order with the workspace still in it.
- SG3 Tokens and order are presentation only (HC13). Failures are ignored. The segment is the one command that writes them (AGENTS.md "Decisions").

## 8. A web panel later (non-goal, the shape it plugs into)

A web panel is another renderer of CP1:
- It reads `cockpitModel(loadProjectView(…), { places: false })`, in-process or as `norn cockpit --json`.
- It draws rows, previews and one control per action.
- It runs `verb` effects through the same dispatcher (`runCli`) or as `norn <argv…> --json`, and shows the `CliError` on refusal.
- It renders `link` as a link.
- It offers no `place` actions. Its own "orient" would be a chat that reads `norn orient <story>`, a later spec.

Nothing in the model is terminal-specific: keys are defaults a web panel may show as shortcuts.

## 9. Contract changes

- `@norn/view`: `cockpitModel`, types `CockpitModel`, `CockpitRow`, `CockpitAction`, `CockpitEffect`.
- `norn cockpit [--interval 5s] [--json] [--next] [--open]` (new); `norn cockpit --json` is P8 data.
- Removed: `norn pane` (all its modes) and `norn pick`; `cockpit.json`'s `notes_seen_at` (no longer read or written).
- The Herdr plugin's entries run `norn cockpit`.

## 10. Tests

- View: `cockpitModel` on a view with one item of each group.
  - Which rows exist and in what order; stable ids.
  - Each action offered exactly where the table says, and absent elsewhere.
  - `{input}` argv; link URLs; no `place` actions without `places`.
- CLI:
  - key parsing (letters, `/`, arrows, the prompt);
  - a scripted session against the harness covering: filter, approve, answer with input, a refused key, trace shown, quit;
  - `--json` printing the model;
  - `--next` and `--open`;
  - `norn pane` and `norn pick` are unknown commands.
- Repo: the plugin manifest's entries name existing scripts that run `norn cockpit`.
