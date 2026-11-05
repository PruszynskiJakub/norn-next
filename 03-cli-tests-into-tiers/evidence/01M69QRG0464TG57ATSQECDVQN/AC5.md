# AC5 (B4, D5)
`bun test --preload ./test/support/unit-guard-preload.ts packages/cli/test/unit`: 114 pass, 0 fail, 5 files (AC5-guard.txt).
Guard bites: the same preload on packages/cli/test/integration/segment.test.ts: 0 pass, 2 fail, thrown from unit-guard.ts:28 (AC5-guard-negative.txt).
Split files, test() count base vs unit+integration: segment 4 = 2+2, tidy-herdr 8 = 4+4. Total across tiers: 1104 + 372 + 72 = 1548 (implement#2 had 1547; +1 for the AC7 hint rule added in implement#3).
