### Goal

Move the hook's decision into a pure core function answering allow, block the turn end, deny the tool call or add context; every agent adapter encodes what its tool carries and reads its native tool call. Behaviour unchanged: only the turn-end block is ever answered.

### Proof

- Core answers the turn-end block exactly as the cli did, attended steps never block (AC1): `packages/core/test/unit/hook-answer.test.ts` › "hookAnswer: the turn-end block" (full reason text pinned; ready-but-unapplied run, foreign session, other run, standing report, non-refusable turn ends, `hooks` tier).
- `norn hook` still blocks, caps and allows through the harness (AC1, AC5): the existing integration cases in `packages/cli/test/integration/agent-protocol.test.ts` ("norn hook robustness", "attended steps never block", "blocks are bounded per run") and `stop-block-cap.test.ts`; CI runs them. The cli takes a capped refusal (`takeRefusal`) only after core answers block (`gatedAnswer` in `packages/cli/src/commands/hook.ts`); everything stays inside the command's catch-all, so an error in `toolCall` or deciding answers allow.
- Encodings (AC2): `claude.test.ts` › "claude hookResponse"; `codex.test.ts` › "deny on PreToolUse and context on SessionStart and UserPromptSubmit; allow for the rest"; `gemini.test.ts` › "deny on BeforeTool and context on SessionStart and BeforeAgent; {} for the rest".
- Allow for what a tool or event cannot carry (AC3): the same tests' allow cases, and `opencode.test.ts` › "it can carry no answer: every answer is allow, and no tool call is read".
- `toolCall` over recorded payloads (AC4): `claude.test.ts` › "claude toolCall" (Bash in full past 300 chars, Write/Edit/MultiEdit/NotebookEdit, EnterWorktree, else null); codex and gemini "toolCall: …" tests.
- `bun run test` (1577 pass) and `bun run typecheck` green (re-run in review #1).
- Review #1: approve, 2 minor notes (findings file passed with the report).

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | core answers the turn-end block exactly as the cli did, attended steps never block; `norn hook` still blocks, caps and allows, taking a capped refusal only after core says block | test | `packages/core/test/unit/hook-answer.test.ts` › "hookAnswer: the turn-end block"; `packages/cli/test/integration/agent-protocol.test.ts` › "attended steps never block", "blocks are bounded per run"; `packages/cli/test/integration/stop-block-cap.test.ts` (CI) |
| AC2 | deny on PreToolUse / BeforeTool and context on SessionStart, UserPromptSubmit / BeforeAgent, encoded per Claude, Codex, Gemini | test | `claude.test.ts` › "claude hookResponse"; `codex.test.ts` › "deny on PreToolUse and context on SessionStart and UserPromptSubmit; allow for the rest"; `gemini.test.ts` › "deny on BeforeTool and context on SessionStart and BeforeAgent; {} for the rest" |
| AC3 | OpenCode, or any answer an event cannot carry, emits allow | test | `opencode.test.ts` › "it can carry no answer: every answer is allow, and no tool call is read"; the allow cases of the three tests above |
| AC4 | `toolCall` over recorded payloads: shell → full command, file tools → paths, `EnterWorktree` → worktree switch, else null | test | `claude.test.ts` › "claude toolCall"; `codex.test.ts` › "toolCall: the shell tool's full command and apply_patch's files; anything else null"; `gemini.test.ts` › "toolCall: run_shell_command's full command, write_file and replace's path; anything else null" |
| AC5 | outside a unit worktree, or on an error gathering facts or deciding, `norn hook` answers allow | test | `agent-protocol.test.ts` › "norn hook robustness" › "outside a unit worktree: no-op, nothing traced", "garbage stdin, unknown events and unknown agents never fail" (CI) |
| story | an agent tool that can't add context or refuse a tool use skips that part | test | as AC3 |
| story | hooks stay fast, no-op outside a unit worktree and allow on their own failure | test | as AC5 |

### Easy to miss

- `toolCall` reads only the pre-tool event (`PreToolUse`, Gemini `BeforeTool`): a call that already ran (PostToolUse) can no longer be refused, so it is null.
- `HookFact` and the trace schema are unchanged (D5); the full command lives only in `ToolCall`.
- Claude blocks only on `Stop`, never on the idle notification's turn end; Codex now checks `native === "Stop"` too (it had only `turn_end` before, which only Stop raises).

### Not proven yet

- Codex's PreToolUse `permissionDecision: deny` and SessionStart/UserPromptSubmit `additionalContext`, Codex's `apply_patch` payload shape (patch text in `tool_input.command`, also read from `input`/`patch`) and its shell tool names beyond `Bash`, and Gemini's BeforeTool deny and SessionStart/BeforeAgent `additionalContext` are taken from the tools' docs, not observed; the new fixtures for them are hand-written from the docs. Claude's new fixtures follow its documented payloads too.
- The harness cases ran only in CI (integration tier), not locally.

### Notes

- `HookDecision` is gone; `HookAnswer` and `ToolCall` live in `packages/core/src/ports.ts`; `hookAnswer` and `foreignFact` in `packages/core/src/hook.ts`. Later slices (05–07) add their answers inside `hookAnswer` and extend `HookAnswerInput` with the facts the cli gathers (rev-parse result, resolved run-state path).
- Shared encoders (`jsonResponse`, `contextOutput`, `denyToolOutput`, `pendingTool`, `shellCall`, `fileWrite`) are in `packages/adapters/src/agent-hooks/index.ts`.
- Friction: a fresh worktree needs `bun install` before `bun run test`, or 73 files fail to resolve packages.

### Resume

Review approved; nothing left in this slice. The next step is QA.
