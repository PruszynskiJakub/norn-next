---
id: gh-301/05
title: Hooks refuse pushes, branch switches and remote-changing gh/glab
depends_on: [ gh-301/01, gh-301/02 ]
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: test }
  - { id: AC7, verifier: test }
---

## Goal
In any unit step, a shell command that pushes, switches branch or worktree, or changes the remote through `gh`/`glab` is refused by the pre-tool hook with the rule's reason, every time it is retried, without spending the end-of-turn cap; the docs say the hooks are a reminder, not a sandbox.

## Scope
User stories: `git push` refused with its reason; branch or worktree switch refused with its reason; remote-changing `gh`/`glab` refused against the list; unlisted `gh`/`glab` commands allowed, reads included; refusals repeat with no cap; fast, no-op outside a unit, allow on own failure; already-installed hooks take the new answers; docs say the hooks are a reminder, not a sandbox. Seams: S2, S3. Decisions D6, D7, D9, D12, D13 (the limitations entry). Out: file writes under run state (gh-301/06); session notes (gh-301/07).

## Acceptance
- AC1 Given a unit step, attended or not, when the agent runs `git push` (also after env assignments, `git -C <dir>` or `-c k=v`, or as one segment of a `;`, `&&`, `||`, `|` or multi-line command), then the tool call is denied with "only norn pushes, because receipts come before effects; if you want this pushed, run it yourself" (or the rules list's wording of it). — verifier: test
- AC2 Given a unit step, when the agent runs `git switch`, `git checkout` with `-b`/`-B`/`--orphan`/`--detach`, `git checkout -`, `gh pr checkout`, `glab mr checkout` or `git worktree add|move|remove`, or a bare `git checkout <name>` that resolves to a commit with no `--` after it, then the call is denied with the no-switch reason; a `git checkout <path>` that does not resolve, or one after `--`, is allowed. — verifier: test
- AC3 Given a unit step, when the agent runs a `gh` or `glab` write on the list (create, edit, comment, review, ready, merge, close, reopen on pull requests, merge requests and issues; labels; release create and delete; repo edit and delete; `api` with a method other than GET or with `-f`, `-F`, `--field`, `--raw-field` or `--input`), then it is denied with the remote rule's reason. — verifier: test
- AC4 Given a unit step, when the agent runs any `gh`/`glab` command not on the list (`view`, `list`, `status`, `diff`, `checks`, a GET `api`), a `git push` inside a quoted string, or a command the tokenizer cannot read, then it is allowed. — verifier: test
- AC5 Given a refused call, when the agent retries it any number of times, then it is refused each time, and each refusal is traced `blocked` with its reason while the end-of-turn cap still allows its full number of turn-end blocks afterwards. — verifier: test
- AC6 Given the hooks as `norn init` installs them today, when `norn hook` receives a pre-tool event in a unit worktree through the cli harness, then the refusal is returned with no reinstall; outside a unit worktree, or on any failure of its own (the rev-parse included), it answers allow. — verifier: test
- AC7 Given the docs, then the limitations entry says the hooks are a reminder, not a sandbox, and names what they miss (shell writes under run state, unlisted remote writes, other norn commands) as still forbidden by the brief; the docs lint passes. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
The cli gathers the one `git rev-parse --verify --quiet <name>^{commit}` fact only for a bare `git checkout <name>`; core decides (D6). D9: `blockedHookCount` counts only `turn_end` lines; check every other reader of `blocked` trace lines (silent classification, `norn run list`) so a tool refusal is not read as a turn-end block (Risks). The S3 harness cases are the integration tier: CI runs them. The tokenizer lives with the refusals and is tested only through whole commands.
