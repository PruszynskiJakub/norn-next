## git diff -M --stat 6b77e395b HEAD -- transcripts, snapshots, golden
 create mode 100644 .agents/specs/gh-118-the-cli-tests-take-12-minutes-and-run-up/runs/03-cli-tests-into-tiers/evidence/01M69QRG0464TG57ATSQECDVQN/AC6-base-golden-add.log
 create mode 100644 .agents/specs/gh-118-the-cli-tests-take-12-minutes-and-run-up/runs/03-cli-tests-into-tiers/evidence/01M69QRG0464TG57ATSQECDVQN/AC6-golden-add.log
 create mode 100644 .agents/specs/gh-118-the-cli-tests-take-12-minutes-and-run-up/runs/03-cli-tests-into-tiers/evidence/01M69QRG0464TG57ATSQECDVQN/AC6-golden-add.out
 create mode 100644 .agents/specs/gh-118-the-cli-tests-take-12-minutes-and-run-up/runs/03-cli-tests-into-tiers/evidence/01M69QRG0464TG57ATSQECDVQN/AC6-golden-update.log
 rename packages/adapters/test/{ => unit}/claude/fixtures/transcript.jsonl (100%)
 rename packages/core/test/{ => unit}/__snapshots__/brief.test.ts.snap (100%)
 rename packages/core/test/{ => unit}/__snapshots__/handoff-inbox.test.ts.snap (100%)
 rename packages/core/test/{ => unit}/golden.test.ts (95%)
 rename packages/store/test/{ => integration}/snapshot.test.ts (66%)
 create mode 100644 packages/store/test/unit/snapshot.test.ts
 rename {packages/cli/test => test/e2e}/observe-snapshots.test.ts (96%)
 rename {packages/cli/test => test/e2e}/observe-snapshots/fresh-intake.json (100%)
 rename {packages/cli/test => test/e2e}/observe-snapshots/gate-waiting.json (100%)
 rename {packages/cli/test => test/e2e}/observe-snapshots/merged.json (100%)
 rename {packages/cli/test => test/e2e}/observe-snapshots/parked-ask.json (100%)
 rename {packages/cli/test => test/e2e}/observe-snapshots/running-slice.json (100%)
 rename {packages/cli/test => test/e2e}/transcripts/base-sync.txt (100%)
 rename {packages/cli/test => test/e2e}/transcripts/e2e-slice-workflow.txt (100%)
 rename {packages/cli/test => test/e2e}/transcripts/recovery-claim-lost.txt (100%)
 rename {scripts => test/repo}/golden.test.ts (75%)
 rename {packages/cli/test => test/support}/golden-harvest.ts (98%)
 rename {packages/cli/test => test/support}/observe-snapshot.ts (75%)
 rename {packages/cli/test => test/support}/transcript.ts (95%)

## content changes (numstat, non-zero only)
(end)
