# Changelog

All notable changes to norn are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/). Before 1.0, a minor version may change the machine contract (JSON output, persisted formats).

## [Unreleased]

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

[Unreleased]: https://github.com/PruszynskiJakub/norn-next/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/PruszynskiJakub/norn-next/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/PruszynskiJakub/norn-next/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/PruszynskiJakub/norn-next/releases/tag/v0.1.0
