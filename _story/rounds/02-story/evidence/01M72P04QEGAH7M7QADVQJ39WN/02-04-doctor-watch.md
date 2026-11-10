## 04.AC1: doctor markdown, version check lines
### repo: 0.29.4
$ norn doctor | grep -i -A2 version

  ok   git            git version 2.54.0 (Apple Git-157)
  ok   agent claude   /Users/jakubpruszynski/.local/bin/claude (2.1.322 (Claude Code)) · hooks fire
  FAIL remote         gh as PruszynskiJakub
--
       machine        jakubpruszynski@mac
  FAIL norn           this repo records norn_version 0.29.4; this norn moves a repo from norn 0.30 on
                      → install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0
  ok   workflows      quick, refinement, reproduce, slice, story, triage valid (.agents/workflows/)
exit=1
### repo: none
$ norn doctor | grep -i -A2 version

  ok   git            git version 2.54.0 (Apple Git-157)
  ok   agent claude   /Users/jakubpruszynski/.local/bin/claude (2.1.322 (Claude Code)) · hooks fire
  FAIL remote         gh as PruszynskiJakub
--
       machine        jakubpruszynski@mac
  FAIL norn           this repo records no norn_version
                      → run `norn init` if norn was never set up here; for a repo from an older norn, install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0
  ok   workflows      quick, refinement, reproduce, slice, story, triage valid (.agents/workflows/)
exit=1

## 02.AC5: norn watch on 0.29.4 (started, 8s)
{"error":"this repo records norn_version 0.29.4; this norn moves a repo from norn 0.30 on","do_instead":"install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0","code":"version_too_old","details":{"repo":"0.29.4","running":"0.30.0"}}
exit=3

## 02.AC5: norn watch --interval 2s on 0.30.0, norn_version removed after ~6s, killed at ~18s
```
{"tick_id":"01M72P68YHBWNYDP1BEF9JMKP3","at":"2026-11-10T12:16:11.217Z","duration_ms":121,"decisions":[],"failed":0}
{"tick_id":"01M72P6AX4ZXA9MG9AZM4NZCPK","at":"2026-11-10T12:16:13.220Z","duration_ms":60,"decisions":[],"failed":0}
{"tick_id":"01M72P6CVN48NA9DJ02C83JSW0","at":"2026-11-10T12:16:15.221Z","duration_ms":55,"decisions":[],"failed":0}
{"at":"2026-11-10T12:16:17.222Z","error":"this repo records no norn_version","do_instead":"run `norn init` if norn was never set up here; for a repo from an older norn, install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0","code":"version_missing","details":{"repo":null,"running":"0.30.0"}}
{"at":"2026-11-10T12:16:19.224Z","error":"this repo records no norn_version","do_instead":"run `norn init` if norn was never set up here; for a repo from an older norn, install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0","code":"version_missing","details":{"repo":null,"running":"0.30.0"}}
{"at":"2026-11-10T12:16:21.225Z","error":"this repo records no norn_version","do_instead":"run `norn init` if norn was never set up here; for a repo from an older norn, install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0","code":"version_missing","details":{"repo":null,"running":"0.30.0"}}
{"at":"2026-11-10T12:16:23.226Z","error":"this repo records no norn_version","do_instead":"run `norn init` if norn was never set up here; for a repo from an older norn, install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0","code":"version_missing","details":{"repo":null,"running":"0.30.0"}}
{"at":"2026-11-10T12:16:25.227Z","error":"this repo records no norn_version","do_instead":"run `norn init` if norn was never set up here; for a repo from an older norn, install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0","code":"version_missing","details":{"repo":null,"running":"0.30.0"}}
{"at":"2026-11-10T12:16:27.229Z","error":"this repo records no norn_version","do_instead":"run `norn init` if norn was never set up here; for a repo from an older norn, install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0","code":"version_missing","details":{"repo":null,"running":"0.30.0"}}
{"ticks":9,"failed_actions":0,"skipped_busy":0,"skipped_version":6,"interval":"2s","released":[]}
exit=0
```
