# AC2 (B2) — status, status --segment, inbox: same output, no day file opened

Same repo and observer as AC1 (15 older day files present; today's moved away). Outputs normalised by dropping `at` and `age` (wall clock).

| command | day files opened (full trace) | (empty trace) | output full vs empty | base: day files opened |
|---|---|---|---|---|
| `norn status --json` | 0 | 0 | identical (2389 B) | 14 |
| `norn status --segment --json` | 0 | 0 | identical | 14 |
| `norn inbox --json` | 0 | 0 | identical | 14 |
| `norn status gh-1 --json` | 0 | 0 | identical | – |
| `norn orient gh-1 --json` (slice goal, not in AC) | 0 | 0 | identical | – |

Files: `AC-full-*.json`, `AC-empty-*.json`.

With today's day file present, which holds the live run's hook lines: `status --json` opens exactly one file, today's (`2026-10-30.jsonl`). That is the local-facts hook read (readHookFacts, window min(now − limits.stalled, live run start)), which slice 04 (B8, per-unit hook files) removes. The slice's test stages days outside that window too.

Suite: trace-free-views.test.ts B2 test passes.
