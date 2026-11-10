## 03.AC5 version_backward: repo 0.31.0, norn 0.30.0
$ norn upgrade --json
{"error":"this repo is set up for norn 0.31.0; upgrade will not move it back","do_instead":"install norn 0.31.x","code":"version_backward","details":{"repo":"0.31.0","running":"0.30.0"}}

exit=3  repo+machine-dir changed: no

staged: 0
## 03.AC5 not_main_checkout: linked worktree of a 0.30.0 repo, norn 0.31.0
/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa6-gh317/b2-wt
$ norn upgrade --json
{"error":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa6-gh317/b2-wt is not the main checkout; norn upgrade moves the main checkout only, so the move never lands in a story's branch","do_instead":"cd /private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa6-gh317/b2 && norn upgrade","code":"not_main_checkout","details":{"main_checkout":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa6-gh317/b2"}}

exit=3  repo+machine-dir changed: no

       0
## 03.AC5 tick_locked: a process holds the tick lock (store acquireTickLock), norn 0.31.0
held: true
$ norn upgrade --json
{"error":"a tick is running (pid 39357, qa holder); norn upgrade never rewrites the repo under a running tick","do_instead":"stop `norn watch` and run it again","code":"tick_locked"}

exit=3  repo+machine-dir changed: no

staged: 0
norn_version: 0.30.0
