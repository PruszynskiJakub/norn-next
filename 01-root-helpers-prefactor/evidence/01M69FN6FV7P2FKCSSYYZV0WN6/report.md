| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| AC1 (B15) | pass | AC1.md | undeclared @norn/fake in scripts/ and @norn/core undeclared in root each fail naming file + import; real tree 43/0; a root test imports @norn/schema, store, cli by name |
| AC2 (B18, B19) | pass | AC2.md, full-suite.log | 1533 pass, typecheck green, git status clean, pinned dirs unchanged |
| AC3 (B19) | pass | AC3.md | UPDATE on base-sync + observe snapshots rewrote files byte-identical; hand-edited transcript restored |
