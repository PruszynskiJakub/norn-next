## 02.AC1/AC3: repo recording 0.29.4
$ norn tick --json
{"error":"this repo records norn_version 0.29.4; this norn moves a repo from norn 0.30 on","do_instead":"install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0","code":"version_too_old","details":{"repo":"0.29.4","running":"0.30.0"}}

exit=3  repo+machine-dir changed: no

$ norn story start gh-1 --json
{"error":"this repo records norn_version 0.29.4; this norn moves a repo from norn 0.30 on","do_instead":"install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0","code":"version_too_old","details":{"repo":"0.29.4","running":"0.30.0"}}

exit=3  repo+machine-dir changed: no

$ norn tick
{"error":"this repo records norn_version 0.29.4; this norn moves a repo from norn 0.30 on","do_instead":"install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0","code":"version_too_old","details":{"repo":"0.29.4","running":"0.30.0"}}

exit=3  repo+machine-dir changed: no

## 02.AC2/AC4: repo recording no norn_version
$ norn tick --json
{"error":"this repo records no norn_version","do_instead":"run `norn init` if norn was never set up here; for a repo from an older norn, install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0","code":"version_missing","details":{"repo":null,"running":"0.30.0"}}

exit=3  repo+machine-dir changed: no

$ norn story start gh-1 --json
{"error":"this repo records no norn_version","do_instead":"run `norn init` if norn was never set up here; for a repo from an older norn, install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0","code":"version_missing","details":{"repo":null,"running":"0.30.0"}}

exit=3  repo+machine-dir changed: no

### 0.30.0 repo: tick is not refused by the baseline
On branch main
nothing to commit, working tree clean
$ norn tick --json
{"tick_id":"01M72P2DCABZJM63VNY82CNNVY","at":"2026-11-10T12:14:04.682Z","duration_ms":208,"sync":{"ran":true,"ok":false,"error":"gh issue list failed (exit 1): no git remotes found"},"decisions":[],"notified":[],"trace":"2026-11-10.jsonl","failed":0,"slowest":{"phase":"observe.sync.issues","ms":56}}

exit=0  repo+machine-dir changed: YES

