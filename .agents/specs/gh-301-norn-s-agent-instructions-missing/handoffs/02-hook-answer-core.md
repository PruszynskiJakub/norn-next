### Goal

Move the hook's decision into a pure core function answering allow, block the turn end, deny the tool call or add context; every agent adapter encodes what its tool carries and reads its native tool call. Behaviour unchanged: only the turn-end block is ever answered.

### Proof

- Core answers the turn-end block exactly as the cli did, attended steps never block (AC1): `packages/core/test/unit/hook-answer.test.ts` › "hookAnswer: the turn-end block" (full reason text pinned; ready-but-unapplied run, foreign session, other run, standing report, non-refusable turn ends, `hooks` tier).
- `norn hook` still blocks, caps and allows through the harness (AC1, AC5): the existing integration cases in `packages/cli/test/integration/agent-protocol.test.ts` ("norn hook robustness", "attended steps never block", "blocks are bounded per run") and `stop-block-cap.test.ts`; CI runs them. The cli takes a capped refusal (`takeRefusal`) only after core answers block (`gatedAnswer` in `packages/cli/src/commands/hook.ts`); everything stays inside the command's catch-all, so an error in `toolCall` or deciding answers allow.
- Encodings (AC2): `claude.test.ts` › "claude hookResponse"; `codex.test.ts` › "deny on PreToolUse and context on SessionStart and UserPromptSubmit; allow for the rest"; `gemini.test.ts` › "deny on BeforeTool and context on SessionStart and BeforeAgent; {} for the rest".
- Allow for what a tool or event cannot carry (AC3): the same tests' allow cases, and `opencode.test.ts` › "it can carry no answer: every answer is allow, and no tool call is read".
- `toolCall` over recorded payloads (AC4): `claude.test.ts` › "claude toolCall" (Bash in full past 300 chars, Write/Edit/MultiEdit/NotebookEdit, EnterWorktree, else null); codex and gemini "toolCall: …" tests.
- `bun run test` (1577 pass) and `bun run typecheck` green.

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

Nothing left in this slice; the next step runs the checks (`bun run test`, `bun run typecheck`).
