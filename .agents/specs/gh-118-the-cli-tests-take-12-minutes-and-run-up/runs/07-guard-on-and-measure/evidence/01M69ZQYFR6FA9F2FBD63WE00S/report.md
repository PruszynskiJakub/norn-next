# QA gh-118/07 (qa#1)
| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| AC1 (B4, B1) | pass | AC1.md | the guard loads in --parallel workers too, switched off by spawning-tier-preload |
| AC2 (B15) | pass | AC2.md, AC2.log | `import * as` from @norn/store not caught (review nit) |
| AC3 (B4) | pass | AC3.md, AC3.log | |
| AC4 (B1, B3) | person | AC4.md | 1.9 s on M2 Max ×3; the person confirms on a clean checkout |
| AC5 (B17) | pass | AC5.md, AC5-diff.txt | base 1,528 (main at 6b77e395b; 1,423 was the planning count) → 1,560: +34 −2, each listed |
| AC6 (B18) | person | AC6.md | renames only; --update 0 changes; golden adds 9, identical on main |
| AC7 (B20) | unverified | AC7.md | local 3× green per tier; no PR/CI yet |
| AC8 (B22) | unverified | AC8.md | table measured except CI wall clock; no PR yet |
| AC9 (B14) | pass | AC9.md, AC9.log | |
