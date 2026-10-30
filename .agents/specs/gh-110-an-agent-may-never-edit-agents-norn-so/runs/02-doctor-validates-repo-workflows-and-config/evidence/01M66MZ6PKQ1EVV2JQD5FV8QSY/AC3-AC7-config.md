# AC3/AC7 — plus max_agents: "two"
```
$ n doctor
norn doctor: 2 checks failed (workflow slice, config)

  ok   workflows      bug, story valid (.agents/norn/workflows/)
                      · the config does not load, so no step's skill was checked against its agent
  FAIL workflow slice .agents/norn/workflows/slice.yaml
                      ! /steps/implement: cycle without a counter: implement.done → test.pass → review.changes_requested → implement (W4)
  FAIL config         .agents/norn/config.yaml
                      ! /max_agents: must be integer

  · machine checks skipped: they need a config that loads; fix it and run norn doctor again
[exit 1]

$ n doctor --repo
norn doctor: 2 checks failed (workflow slice, config)

  ok   workflows      bug, story valid (.agents/norn/workflows/)
                      · the config does not load, so no step's skill was checked against its agent
  FAIL workflow slice .agents/norn/workflows/slice.yaml
                      ! /steps/implement: cycle without a counter: implement.done → test.pass → review.changes_requested → implement (W4)
  FAIL config         .agents/norn/config.yaml
                      ! /max_agents: must be integer
[exit 1]

$ n doctor --repo --json
{"ok":false,"repo":{"ok":false,"workflows":[{"name":"bug","file":".agents/norn/workflows/bug.yaml","ok":true,"issues":[]},{"name":"slice","file":".agents/norn/workflows/slice.yaml","ok":false,"issues":[{"code":"uncounted_cycle","path":"/steps/implement","message":"cycle without a counter: implement.done → test.pass → review.changes_requested → implement (W4)","cycle":["implement","test","review"]}]},{"name":"story","file":".agents/norn/workflows/story.yaml","ok":true,"issues":[]}],"config":{"ok":false,"file":".agents/norn/config.yaml","present":true,"errors":[{"path":"/max_agents","message":"must be integer"}]},"skills_unchecked":"the config does not load, so no step's skill was checked against its agent"}}
[exit 1]

```
