# AC3 (B20) provider fails → PortError, nothing changes
Contract tests pass for all three subjects. Direct drive after failLabelEdits():
- gh: rejects AdapterError {code: gh_network, retryable: true}; labels unchanged [norn, norn:wf:triage]
- glab: rejects AdapterError {code: glab_network, retryable: true}; labels unchanged
- FakeRemote: `labelError = new Error("boom")` → rejects "boom", labels unchanged, call still recorded in `calls`
Real gh binary (AC3-real-gh.log), nonexistent repo: rejects AdapterError {code: gh_failed, retryable: false} at the read, before any edit.
