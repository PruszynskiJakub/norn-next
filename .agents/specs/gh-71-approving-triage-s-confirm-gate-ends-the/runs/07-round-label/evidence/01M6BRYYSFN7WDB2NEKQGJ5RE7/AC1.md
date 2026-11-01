# AC1 (B19) — label swap triage → story, once
Ran: `bun test --config=bunfig.integration.toml packages/cli/test/integration/human.test.ts --reporter=junit --reporter-outfile=human-junit.xml` (36 pass, 0 fail; junit: 0 failures).
Test `B19 (D9): round 2 swapped the issue's norn:wf:triage label for norn:wf:story, once` (human.test.ts:765) passed with 2 assertions.
Setup: issue #14 is labelled `norn, norn:wf:triage`. Round 1 (triage) finishes via manual approve to $done, then `norn story edit gh-14 --workflow story` starts round 2.
Observed: the FakeRemote's label calls are exactly `["label 14 -norn:wf:triage +norn:wf:story"]`, and #14's labels become `["norn","norn:wf:story"]`.
Code: core decide/story.ts roundStart sets `label` only when the workflow changes; act lifecycle.ts calls `replaceIssueLabel` after the story file patch and the commit (D9).
