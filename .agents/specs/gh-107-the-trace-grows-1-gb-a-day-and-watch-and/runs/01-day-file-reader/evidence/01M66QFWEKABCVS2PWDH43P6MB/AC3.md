# AC3 (B4) — type first on write; trace-read observer sees every day file opened
Tests (verifier): config-trace.test.ts "B4 (D2): every line is written with `type` as its first key" and "B4: the trace-read observer sees every day file each reader opens" → pass; agent-protocol B4 test (observer sees day files for trace, hook stop, tick, inbox --history) → pass.
CLI: fresh throwaway repo, HOME isolated, two `bun packages/cli/src/main.ts tick` runs on the branch → 6 trace lines (tick.start, tick, tick.end ×2), all starting `{"type":"` (AC3/written.jsonl; 0 non-type-first lines).
The observer is a test hook only (setTraceReadObserver), so it can only be observed through the tests.
