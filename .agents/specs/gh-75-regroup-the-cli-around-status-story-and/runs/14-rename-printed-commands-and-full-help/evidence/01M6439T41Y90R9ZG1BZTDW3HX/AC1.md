# AC1 — inbox/status items name new commands
Observed live (AC8-drive.log, `norn status` section), harness repo driven by the dev build's CLI (fake remote/runner, real git):
- gate gh-5 under Approve: `$ norn story approve gh-5` (and `or reject: norn story reject gh-5 --reason "…"`)
- stuck gh-7 under Unblock: `$ norn run rerun gh-7`
- question gh-6 under Answer: `$ norn story answer gh-6 "…"`
- running gh-9: `$ norn run list gh-9`
- corrupt gh-8 under Unblock: `$ norn run view gh-8 --why`
Full suite 1374 pass / 0 fail; typecheck green.
