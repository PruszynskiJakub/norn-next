# AC2 (B4) — broken line of an unshown type is not reported by `norn trace`; an every-type reader still reports it
Tests (verifier): store config-trace.test.ts "B4 (D2): a reader given types skips lines of other types unparsed; a reader of every type reports them" → pass; cli agent-protocol B4 test → pass.
CLI: appended `{"type":"tick.start","tick_id":BROKEN` and `not json at all` to 2026-10-29.jsonl; `trace gh-75` exit 0 on both builds, output identical between v0.11.1 and branch, and the same as the clean trace apart from one minute of clock drift on the open gate (AC2/*-broken.md).
Note (from review): `norn trace` never surfaced read errors, so the CLI half cannot go red; the skip itself is shown by the S2 store test (typed reader reports no error, untyped reader reports it).
