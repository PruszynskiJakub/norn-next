$ norn status   (fresh clone; stdout and stderr captured apart)
[exit 0]
stdout:
Inbox empty — no stories yet.
Label an issue `norn` (the config's `remote.label`) and assign it to yourself, then run `norn sync`.
stderr:
`norn status` now shows what needs you; the story listing moved to `norn story list`.
$ norn status   (second run)
[exit 0]
stderr bytes:        0
stdout identical to first: yes
$ norn status --json  (fresh clone, first run)
stdout is one JSON value
stderr: 
