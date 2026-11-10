## 02.AC1/AC2: the baseline rule via the library entry point (@norn/core versionBaseline), running 0.31.0
(the CLI's refusal for each is in 02-guard.md)
```
"0.29.4" → baseline {"code":"version_too_old","needs":"0.30.x","error":"this repo records norn_version 0.29.4; this norn moves a repo from norn 0.30 on","do_instead":"install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.31.0"} | mismatch {"match":"newer","needs":"0.29.4 or a later 0.29.x","error":"this repo needs norn 0.29.4 or a later 0.29.x (you run 0.31.0)","do_instead":"run `norn upgrade` to move this repo to norn 0.31.0 and commit the change, or install norn 0.29.4 or a later 0.29.x"}
null → baseline {"code":"version_missing","needs":"0.30.x","error":"this repo records no norn_version","do_instead":"run `norn init` if norn was never set up here; for a repo from an older norn, install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.31.0"} | mismatch "n/a"
"0.30.0" → baseline null | mismatch {"match":"newer","needs":"0.30.x","error":"this repo needs norn 0.30.x (you run 0.31.0)","do_instead":"run `norn upgrade` to move this repo to norn 0.31.0 and commit the change, or install norn 0.30.x"}
"0.30.7" → baseline null | mismatch {"match":"newer","needs":"0.30.7 or a later 0.30.x","error":"this repo needs norn 0.30.7 or a later 0.30.x (you run 0.31.0)","do_instead":"run `norn upgrade` to move this repo to norn 0.31.0 and commit the change, or install norn 0.30.7 or a later 0.30.x"}
"0.31.2" → baseline null | mismatch {"match":"older","needs":"0.31.2 or a later 0.31.x","error":"this repo needs norn 0.31.2 or a later 0.31.x (you run 0.31.0)","do_instead":"install norn 0.31.2 or a later 0.31.x"}
```
