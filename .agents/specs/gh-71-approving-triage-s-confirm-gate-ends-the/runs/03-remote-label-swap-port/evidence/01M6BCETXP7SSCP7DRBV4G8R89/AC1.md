# AC1 (B19) swap triage → story
Contract: `bun test --config=bunfig.integration.toml packages/adapters/test/integration/contract/contract.test.ts packages/cli/test/integration/contract-fakes.test.ts -t replaceIssueLabel` → 9 pass / 0 fail (3 tests × gh, glab, FakeRemote); log AC-contract-replaceIssueLabel.log.
Direct drive (drive.log), issue #5 labelled [norn, norn:wf:triage]:
- gh: argv `gh issue view 5 --json labels` then `gh issue edit 5 --remove-label norn:wf:triage --add-label norn:wf:story` → read-back [norn, norn:wf:story]
- glab: `glab issue update 5 --unlabel norn:wf:triage --label norn:wf:story` → [norn, norn:wf:story]
- FakeRemote: → [norn, norn:wf:story], calls ["label 5 -norn:wf:triage +norn:wf:story"]
