## Goal
In any unit step, the pre-tool hook refuses a `git push`, a branch or worktree switch and a remote-changing `gh`/`glab` command with the rule's reason, on every retry, without spending the turn-end cap; the docs say the hooks are a reminder, not a sandbox.

## Proof
- Push refused with its reason (AC1), switches (AC2), the gh/glab write list (AC3), unlisted commands, quoted pushes and unreadable commands allowed (AC4), refusals repeat (AC5, core part): `packages/core/test/unit/hook-refusals.test.ts` (S2, through `hookAnswer` on whole commands; red first: `checkoutNames` and the deny answers did not exist).
- The cap counts only turn-end blocks (AC5): `packages/store/test/unit/config-trace.test.ts` › "the blocked count counts only turn-end blocks, never a refused tool call" (red first: counted 5 tool refusals).
- Wiring end to end (AC5 cap untouched, AC6 hooks as `norn init` installs them, no-op outside a unit, allow when its own git fails, the rev-parse fact): `packages/cli/test/integration/hook-refusals.test.ts` (S3, integration tier: CI runs it; not run locally per the brief).
- Docs (AC7): `docs/limitations.md` entry "The hooks are a reminder, not a sandbox", naming what they miss; docs lint green in `bun run test`. `docs/reference.md` re-emitted for the `norn hook` summary.
- `bun run test` and `bun run typecheck` green.

Review #1 traceability:

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | `git push` denied with the no-push reason, after env vars, `-C`/`-c`, in any segment, attended or not | test | `packages/core/test/unit/hook-refusals.test.ts` › "the denial carries the no-push rule…", "attended steps are refused alike"; S3 `packages/cli/test/integration/hook-refusals.test.ts` › "a git push is denied with the rule's reason…" |
| AC2 | switches denied; a bare checkout only when it resolves to a commit and no `--` follows | test | core › "%p is refused with the no-switch reason", "a bare checkout is refused only when…"; S3 › "a bare checkout is denied only when its name resolves…" |
| AC3 | gh/glab writes on the list denied with the remote reason | test | core › "%p is refused with the remote rule's reason" — gh only; glab note/update/approve/revoke UNTRACED (finding F1) |
| AC4 | unlisted gh/glab commands, quoted pushes and unreadable commands allowed | test | core › "%p is allowed" |
| AC5 | refused on every retry, traced `blocked`, turn-end cap untouched | test | core › "a refused call is refused on every retry"; `packages/store/test/unit/config-trace.test.ts` › "the blocked count counts only turn-end blocks…"; S3 › "tool refusals leave the end-of-turn cap its full number of blocks" |
| AC6 | installed hooks answer with no reinstall; allow outside a unit and on its own failure | test | S3 › "the PreToolUse hook norn init installed today…", "outside a unit worktree it allows", "when its own git fails, it allows" |
| AC7 | limitations entry: hooks are a reminder, not a sandbox, naming what they miss; docs lint passes | test | UNTRACED (finding F2): docs lint only |

## Easy to miss
- PostToolUse/AfterTool also map to `tool_use`; only the pre event yields a `toolCall`, so only it is refused.
- A bare `git checkout <name>` needs the cli's `git rev-parse --verify --quiet <name>^{commit}` (run only for those commands, with the hook's env); a git that does not answer throws and the hook allows.
- A heredoc (`<<`) or unterminated quote makes the whole command unreadable: allowed.

## Not proven yet
- AC3 for glab: `glab mr/issue note`, `mr/issue update`, `mr approve`/`revoke` are allowed (F1, blocking).
- AC7: no test pins the limitations entry (F2, blocking).
- The new integration file has not been run locally (the brief forbids the integration tier before hand-back); CI runs it.

## Notes
- Tokenizer and refusal list live in `packages/core/src/shell-refusals.ts`, tested only through `hookAnswer`. `(`, `)` and backticks split segments too, so `$(git push)` is refused (it would push).
- Deny reason: "norn refused this call. <rule>: <reason>; if you want this pushed, run it yourself." built from the hard rules list.
- Review #1: changes requested, F1 (glab verbs) and F2 (AC7 test) blocking; F3–F8 are notes (checkout `-- -b` refused, rev-parse timeout drops the trace line, `--git-dir x`/`gh pr --repo x` slip through, duplicated checkout parsing, cap test order, direct `checkoutNames` asserts).
- Readers of `blocked` trace lines: only `blockedHookCount` (now turn_end only) and the timeline display, which shows the refusal reason.

## Resume
Rework: add glab's note/update/approve/revoke to the write list in `packages/core/src/shell-refusals.ts` with core test cases; add a unit test pinning the `docs/limitations.md` entry by terms; then `bun run test` and `bun run typecheck`.
