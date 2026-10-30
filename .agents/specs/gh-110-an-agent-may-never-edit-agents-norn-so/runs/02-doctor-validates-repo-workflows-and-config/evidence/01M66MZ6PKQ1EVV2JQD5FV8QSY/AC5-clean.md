# AC5 — doctor --repo, PATH=/usr/bin:/bin:/Users/jakubpruszynski/.bun/bin (no claude/codex/gh)
```
$ n doctor --repo
norn doctor: every check passes

  ok   workflows      bug, slice, story valid (.agents/norn/workflows/)
  ok   config         .agents/norn/config.yaml
[exit 0]

$ n doctor --repo --json
{"ok":true,"repo":{"ok":true,"workflows":[{"name":"bug","file":".agents/norn/workflows/bug.yaml","ok":true,"issues":[]},{"name":"slice","file":".agents/norn/workflows/slice.yaml","ok":true,"issues":[]},{"name":"story","file":".agents/norn/workflows/story.yaml","ok":true,"issues":[]}],"config":{"ok":true,"file":".agents/norn/config.yaml","present":true,"errors":[]}}}
[exit 0]

```
