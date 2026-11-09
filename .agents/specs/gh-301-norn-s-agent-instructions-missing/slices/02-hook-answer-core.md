---
id: gh-301/02
title: Hook answers decided in core and encoded per agent tool
depends_on: []
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
---

## Goal
The hook's decision moves from the cli command into a pure core function whose answer is allow, block the turn end, deny the tool call or add context; every agent adapter encodes the answers its tool supports and normalizes its native tool call. Behaviour today stays the same: only the turn-end block is ever answered.

## Scope
User stories: an agent tool that can't add context or refuse a tool use skips that part; hooks stay fast, no-op outside a unit worktree and allow on their own failure (kept through the move). Seams: S2 (the turn-end block case), S3 (existing robustness and cap cases unchanged), S4 (encodings and `toolCall`). Prefactor 2. Decisions D4, D5. Out: any new answer actually being produced (gh-301/05–07).

## Acceptance
- AC1 Given the cases the end-of-turn hook blocks today (and the attended steps it never blocks), when the core hook-answer function is asked, then it answers exactly as the cli did, and `norn hook` through the harness still blocks, caps and allows as before, taking one of the capped refusals in the cli only after core says block. — verifier: test
- AC2 Given a deny or an add-context answer, when the Claude adapter encodes it, then PreToolUse gets `permissionDecision: deny` with the reason and SessionStart and UserPromptSubmit get `additionalContext`; Codex encodes the same on its PreToolUse, SessionStart and UserPromptSubmit; Gemini encodes BeforeTool `decision: deny` and SessionStart and BeforeAgent `additionalContext`. — verifier: test
- AC3 Given the OpenCode adapter, or any adapter asked to encode an answer its tool or event cannot carry, then it emits allow. — verifier: test
- AC4 Given recorded native payloads, when an adapter's `toolCall` reads them, then a shell tool call becomes its full command (Claude `Bash`, Codex's shell tool, Gemini `run_shell_command`), a file tool call becomes its paths (Claude `Write`/`Edit`/`MultiEdit`/`NotebookEdit`, Codex `apply_patch`'s files, Gemini `write_file`/`replace`), Claude's `EnterWorktree` becomes a worktree switch, and anything else is null. — verifier: test
- AC5 Given any hook event outside a unit worktree, or an error while gathering facts or deciding, then `norn hook` answers allow, as today. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
`toolCall` is not persisted: `HookFact` and the trace schema stay as they are (D5). Extend `hook-payloads.json` with PreToolUse, SessionStart and UserPromptSubmit payloads per tool; record real ones where possible and say in the handoff which Codex and Gemini encodings are taken from docs, not observed (Risks). The cli harness cases (`agent-protocol.test.ts`, `stop-block-cap.test.ts`) are the integration tier: CI runs them.
