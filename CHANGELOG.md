# Changelog

All notable changes to norn are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/). Before 1.0, a minor version may change the machine contract (JSON output, persisted formats).

## [Unreleased]

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

[Unreleased]: https://github.com/PruszynskiJakub/norn-next/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/PruszynskiJakub/norn-next/releases/tag/v0.1.0
