# AC2 (B19) old label missing
Contract tests pass for all three subjects (see AC1.md). Direct drive, issue #6 labelled [norn]:
- gh: reads labels, issues `gh issue edit 6 --add-label norn:wf:story` (no --remove-label, which the scripted gh would refuse like real gh) → [norn, norn:wf:story], no error
- glab: `--unlabel norn:wf:triage --label norn:wf:story` → [norn, norn:wf:story], no error
- FakeRemote: removing an absent label, adding norn:wf:x → added, no error
