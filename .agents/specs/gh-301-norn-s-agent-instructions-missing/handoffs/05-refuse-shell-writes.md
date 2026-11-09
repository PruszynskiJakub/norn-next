## Goal
In any unit step, the pre-tool hook refuses a `git push`, a branch or worktree switch and a remote-changing `gh`/`glab` command with the rule's reason, on every retry, without spending the turn-end cap; the docs say the hooks are a reminder, not a sandbox.

## Proof
- Push refused with its reason (AC1), switches (AC2), the gh/glab write list (AC3), unlisted commands, quoted pushes and unreadable commands allowed (AC4), refusals repeat (AC5, core part): `packages/core/test/unit/hook-refusals.test.ts` (S2, through `hookAnswer` on whole commands; red first: `checkoutNames` and the deny answers did not exist).
- The cap counts only turn-end blocks (AC5): `packages/store/test/unit/config-trace.test.ts` › "the blocked count counts only turn-end blocks, never a refused tool call" (red first: counted 5 tool refusals).
- Wiring end to end (AC5 cap untouched, AC6 hooks as `norn init` installs them, no-op outside a unit, allow when its own git fails, the rev-parse fact): `packages/cli/test/integration/hook-refusals.test.ts` (S3, integration tier: CI runs it; not run locally per the brief).
- Docs (AC7): `docs/limitations.md` entry "The hooks are a reminder, not a sandbox", naming what they miss; docs lint green in `bun run test`. `docs/reference.md` re-emitted for the `norn hook` summary.
- `bun run test` and `bun run typecheck` green.

## Easy to miss
- PostToolUse/AfterTool also map to `tool_use`; only the pre event yields a `toolCall`, so only it is refused.
- A bare `git checkout <name>` needs the cli's `git rev-parse --verify --quiet <name>^{commit}` (run only for those commands, with the hook's env); a git that does not answer throws and the hook allows.
- A heredoc (`<<`) or unterminated quote makes the whole command unreadable: allowed.

## Not proven yet
- The new integration file has not been run locally (the brief forbids the integration tier before hand-back); CI runs it.

## Notes
- Tokenizer and refusal list live in `packages/core/src/shell-refusals.ts`, tested only through `hookAnswer`. `(`, `)` and backticks split segments too, so `$(git push)` is refused (it would push).
- Deny reason: "norn refused this call. <rule>: <reason>; if you want this pushed, run it yourself." built from the hard rules list.
- glab's `note`/`approve` are not on the list (the spec's list names `comment`/`review`); add them if wanted.
- Readers of `blocked` trace lines: only `blockedHookCount` (now turn_end only) and the timeline display, which shows the refusal reason.

## Resume
Review the slice: diff against the story branch, run `bun run test` and `bun run typecheck`.
