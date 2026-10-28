# QA gh-75/01 — run list / run view

Branch head f05d783. `bun test` 1208 pass / 0 fail, typecheck green (tests.txt).
Throwaway repo built with the cli test harness (fake remote/runner, real git, 13 ticks, story gh-5 parked at a gate);
branch CLI = `bun packages/cli/src/main.ts` (new.sh / n.sh), released norn 0.10.0 = old.sh, both against the same repo.

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| AC1 (B2) | pass | AC1.txt, AC1-help.txt | `norn run` and `norn help run` list list, view in order, exit 0; top help row `norn run … (list, view)` |
| AC2 (B4) | pass | AC2.txt | `help run view` == `run view --help`, usage + Options, exit 0 |
| AC3 (B43,B70) | pass | AC3.txt, AC3-parity.txt | `run list gh-5` byte-identical to 0.10.0 `trace gh-5` for every flag, text and --json |
| AC4 (B44,B6) | pass | AC4.txt | unit → latest run; run id → that run; --json one value; unknown run 3, no target 2 |
| AC5 (B45,B70) | pass | AC5.txt | --why with --tick/--step/--attempt/--transition/--rule and --receipt (with and without unit) identical to `why`; refusals' do_instead now names `run list` |
| AC6 (B5) | pass | AC6.txt | trace/why → exit 2 "Unknown command: …", do_instead `norn help — …`; no file written |
| AC7 (B69) | pass | tests.txt, AC7-cli.txt | test diffs are only trace/why renames + new tests; transcripts/snapshots untouched; status/inbox/config/doctor identical to 0.10.0 bar wall-clock `at` |
| AC8 | pass | AC3.txt, AC4.txt, AC8-why.txt, AC8-receipt.txt | read correctly; --why/--receipt print one-line JSON as `why` did |
