<p align="center">
  <img src="docs/assets/norn.svg" alt="norn" width="96" height="96">
</p>

<h1 align="center">norn</h1>

<p align="center">
  <strong>Hand software stories to coding agents, and always know what is waiting for you.</strong>
</p>

<p align="center">
  <a href="https://github.com/PruszynskiJakub/norn-next/actions/workflows/ci.yml"><img src="https://github.com/PruszynskiJakub/norn-next/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/PruszynskiJakub/norn-next/releases"><img src="https://img.shields.io/badge/release-v0.26.0-blue" alt="Latest release"></a>
  <img src="https://img.shields.io/badge/bun-%3E%3D1.3-f9f1e1" alt="Bun 1.3 or later">
</p>

> [!NOTE]
> norn is pre-1.0: a minor version can change the machine contract (JSON output, persisted formats), and [`CHANGELOG.md`](CHANGELOG.md) says what changed. It is tested on Claude Code; Codex, OpenCode and Gemini should work but are less exercised.

You give a story to a coding agent and switch to something else. Forty minutes later you look back: the agent has been waiting on a question in a pane you closed. Or it died halfway through. Or it ran the same failing test three times, said it was done, and nothing checked.

**norn delivers stories with coding agents one bounded step at a time, and keeps one inbox of everything that needs you.** You label a GitHub or GitLab issue. norn takes it in, gives it a branch and a worktree, and walks it through a workflow: triage, refine the spec with you, plan, implement in slices, test, review, QA, open a draft PR. Agents do the steps. Plain code decides what comes next, notices when an agent asks, dies or stalls, and tells you which command answers it.

## Is norn for you?

**A good fit today:** one person, Claude Code, GitHub, a test suite you trust, and stories big enough to plan. Several stories can run in parallel on one machine, started by you (manual mode) or by norn (auto mode).

**Not yet, or not at all:** quick interactive edits (norn works per story, on a heartbeat), repositories without GitHub or GitLab issues and PRs, and teams that require linear history on every branch (norn merges the base into story branches and never rebases). GitLab, agents other than Claude Code and two machines on one story are built but not proven in real use. [Limitations](docs/limitations.md) lists all of it.

## Install

You need git ≥ 2.38, an agent CLI (Claude Code is the tested one), and `gh` or `glab` signed in.

**Single-file binary** (no Bun, no token). Each release carries `norn-darwin-arm64`, `norn-darwin-x64`, `norn-linux-x64`, `norn-linux-arm64` and `SHA256SUMS`:

```sh
curl -fsSLO https://github.com/PruszynskiJakub/norn-next/releases/latest/download/norn-darwin-arm64
sudo install -d /usr/local/bin           # missing on a fresh Apple Silicon Mac
sudo install -m 755 norn-darwin-arm64 /usr/local/bin/norn
norn --version
```

**From GitHub Packages** (npm). The package needs [Bun](https://bun.sh) ≥ 1.3 on `PATH`, and GitHub's npm registry asks for a token even to install: create a personal access token (classic) with the `read:packages` scope, then:

```sh
echo "@pruszynskijakub:registry=https://npm.pkg.github.com" >> ~/.npmrc
echo "//npm.pkg.github.com/:_authToken=<your token>" >> ~/.npmrc
bun add -g @pruszynskijakub/norn      # or: npm install -g @pruszynskijakub/norn
```

## Set up a repository

```sh
cd your-repo
norn init
```

`norn init` writes the team config (`.agents/norn.config.yaml`, with the norn version the repo now needs), a commented user config (`~/.norn/config.yaml`) on a machine's first init, six workflows in `.agents/workflows/`, the agent skills and hooks, a starter `REVIEW.md` (what a review ignores, counts as failure and does not report) when the repo has none, a JSON schema next to each config file for your editor, and its `.gitignore` lines. On the remote it creates the labels norn uses (see [Concepts: Labels](docs/concepts.md#labels)); when it cannot, it says why and what to run. It reads your test command from your build files and ends with the next steps:

```console
Next steps
  1. Check the test command `npm install && npm test` in the `test` steps of .agents/workflows/ (detected from package.json).
  2. Commit and push the setup: `git add .agents .claude REVIEW.md .gitignore && git commit -m "Set up norn" && git push`.
  3. Check this machine: `norn doctor`.
  4. Make a first story: an issue labelled `norn` and assigned to you, e.g. `gh issue create --label norn --assignee @me --title "…"`.
  5. Pick it up: `norn sync`, then `norn status` shows what needs you and the command for each item; `norn watch` keeps norn working.
```

Do the first three. `norn status` then has nothing for you yet:

```console
$ norn status
Inbox empty — no stories yet.
Label an issue `norn` and assign it to yourself, then run `norn sync`.
```

Config is optional: a solo developer on GitHub with Claude Code writes none. It lives in three files: `~/.norn/config.yaml` (your machine and your defaults), `.agents/norn.config.local.yaml` (yours in this repository, gitignored) and `.agents/norn.config.yaml` (the team's, committed); which keys go where is in [Reference: Config](docs/reference.md#config). norn reads GitHub or GitLab from the remote URL; a self-hosted host sets `provider: gh` or `provider: glab` in the team file. A repository set up by an older norn, or a config written for one, refuses every command and names `norn upgrade` (and each old key with its replacement): run it once in the main checkout, with `norn watch` stopped, and commit what it prints. A repository records the norn version it needs (`norn_version`): a binary of another minor refuses to act on it and names the norn to install. Moving a team to a new norn is in [Recipes: Roll out a new norn to a team](docs/recipes.md#roll-out-a-new-norn-to-a-team).

## Run a first story

```sh
gh issue create --label norn --assignee @me --title "Add CSV export of orders"
norn sync      # the issue becomes story gh-N: a branch, a worktree, a spec folder
norn watch     # keeps norn working; Ctrl-C finishes the current tick and releases claims
norn status    # in another terminal: what needs you, with the command for each item
```

1. A new story runs the `triage` workflow. In manual mode (the default) `norn status` shows its first agent step as ready, with the command that starts it: `norn story start gh-N` with the Herdr runner, otherwise a line that opens your agent in the story's worktree on its brief.
2. The triage agent checks the issue against your code, posts its findings and one recommendation as an issue comment, and labels the issue's kind, risk and priority. The round ends there.
3. You start the next round: `norn story edit gh-N --workflow quick` for a small change, `--workflow refinement` to agree a spec and plan with an agent first, then `--workflow story` to build it in slices.
4. The workflow runs. Whenever an agent asks, a gate waits for your approval or something is stuck, the item appears in `norn status` with the command that resolves it (`norn story answer`, `norn story approve`, `norn run rerun`, …).
5. A delivery workflow ends at a `ready` gate with a draft PR. Your last act is merging it. The PR holds your code, the spec and the handoffs; norn's run state stays on your machine and is archived on a ref of its own, never on your base branch ([Concepts: What gets committed](docs/concepts.md#what-gets-committed-and-where-run-state-lives)).

`norn help` lists every command and who runs it; `norn help <command>` shows one.

## Where to go next

| Doc | For |
|---|---|
| [Concepts](docs/concepts.md) | how norn works: stories, units, workflows, steps, gates, the inbox, modes, one tick, and the glossary |
| [Reference](docs/reference.md) | every command, flag and config key, the workflows `norn init` ships and the exit codes |
| [Recipes](docs/recipes.md) | what to do when an agent asks or dies, the base moves, you want your own workflow, you hand a story over, or you roll out a new norn |
| [Limitations](docs/limitations.md) | what is not built, not proven in real use, or out of scope by design |
| [Herdr plugin](plugins/herdr/README.md) | the cockpit (`norn status --watch`) inside Herdr, with keys and a tab bar segment |
| [Contributing](CONTRIBUTING.md) | how norn is built with norn, and how to propose a change |

## Contributing

norn is built with norn. Start with [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Credits

The `norn-codebase-design` and `norn-tdd` skills and the approach of the step skills are adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT), by way of the earlier norn; `norn-pr`, `norn-diagnose`, `norn-prototype` and `norn-retro` are adapted from its `pr`, `diagnosing-bugs`, `prototype` and `retro` skills directly.
