## repo norn_version=0.29.4
$ norn tick --json
{"error":"this repo records norn_version 0.29.4; this norn moves a repo from norn 0.30 on","do_instead":"install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0","code":"version_too_old","details":{"repo":"0.29.4","running":"0.30.0"}}

exit=3  repo+machine-dir changed: no

$ norn story start gh-1 --json
{"error":"this repo records norn_version 0.29.4; this norn moves a repo from norn 0.30 on","do_instead":"install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0","code":"version_too_old","details":{"repo":"0.29.4","running":"0.30.0"}}

exit=3  repo+machine-dir changed: no

$ norn status
`norn status` now shows what needs you; the story listing moved to `norn story list`.
! this repo records norn_version 0.29.4; this norn moves a repo from norn 0.30 on: install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0
      $ norn doctor

exit=0  repo+machine-dir changed: YES

$ norn status --json
{"at":"2026-11-10T10:10:33.497Z","groups":{"your_turn":[],"answer":[],"approve":[],"unblock":[{"story":"*","slice":null,"step":null,"command":"norn doctor","since":"2026-11-10T10:10:33.497Z","id":"norn-version:0.29.4:0.30.0","group":"unblock","title":"this repo records norn_version 0.29.4; this norn moves a repo from norn 0.30 on: install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0","age":"0s"}],"check":[],"unclaimed":[],"running":[],"notes":[],"recently_done":[]},"pending":1,"delegated_counts":{},"heartbeat":{"holder":"tester@box","last_tick_at":null,"age":null,"down":false,"up":false}}

exit=0  repo+machine-dir changed: no

## repo norn_version=none
$ norn tick --json
{"error":"this repo records no norn_version","do_instead":"run `norn init` if norn was never set up here; for a repo from an older norn, install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0","code":"version_missing","details":{"repo":null,"running":"0.30.0"}}

exit=3  repo+machine-dir changed: no

$ norn story start gh-1 --json
{"error":"this repo records no norn_version","do_instead":"run `norn init` if norn was never set up here; for a repo from an older norn, install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0","code":"version_missing","details":{"repo":null,"running":"0.30.0"}}

exit=3  repo+machine-dir changed: no

$ norn status
`norn status` now shows what needs you; the story listing moved to `norn story list`.
! this repo records no norn_version: run `norn init` if norn was never set up here; for a repo from an older norn, install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0
      $ norn doctor

exit=0  repo+machine-dir changed: YES

$ norn status --json
{"at":"2026-11-10T10:10:35.158Z","groups":{"your_turn":[],"answer":[],"approve":[],"unblock":[{"story":"*","slice":null,"step":null,"command":"norn doctor","since":"2026-11-10T10:10:35.158Z","id":"norn-version:none:0.30.0","group":"unblock","title":"this repo records no norn_version: run `norn init` if norn was never set up here; for a repo from an older norn, install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0","age":"0s"}],"check":[],"unclaimed":[],"running":[],"notes":[],"recently_done":[]},"pending":1,"delegated_counts":{},"heartbeat":{"holder":"tester@box","last_tick_at":null,"age":null,"down":false,"up":false}}

exit=0  repo+machine-dir changed: no

