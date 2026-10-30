# AC1 (B11) — status --watch draws the cockpit; --interval; --watch --json is the cockpit model; status --json stays the inbox
Real CLI, throwaway repo (`norn init`), dev build `bun packages/cli/src/main.ts`:
- `status --json` → `{"at":…,"groups":{"your_turn":[],…},"pending":0}` exit 0 (the inbox JSON, B10)
- `status --watch --json` → `{"at":…,"header":{"repo":…,"pending":0,"heartbeat":{…}},"rows":[]}` exit 0 (the cockpit model)
- `status --interval 5s` (without --watch) → usage error "--interval needs --watch", do_instead `norn status --watch`, exit 2
- Under a real pty, `status --watch --interval 1s` drew 4 frames in 3.5s and quit on q (and on Esc) with exit 0: see AC7-q.txt, AC7-esc.txt
- The frame shows the stories list, the preview column, and the key bar `/ filter · ? keys · q quit`
S1 tests (fake Herdr, scripted keys) in status-watch.test.ts: "keys (CP7)", "the frame…", "a session: … quit", "status --json stays the inbox (B10); --interval needs a duration" — all green (53/53 in the file + herdr adapter tests; full suite 1261/1261).
Full CLI transcript: cli.txt, exitcodes.txt
