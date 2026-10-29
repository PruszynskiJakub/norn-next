# AC2 (B12) — status --watch --pane
- Outside Herdr (all HERDR_* env removed): `status --watch --pane` → `**Refused (not_in_herdr):** not inside Herdr: there is no pane to split` / `Do instead: norn status --watch`, exit 3; same with `--json` → `{"error":"not inside Herdr: there is no pane to split","do_instead":"norn status --watch","code":"not_in_herdr"}` (AC2-outside-herdr.txt)
- `help status` lists `--pane  with --watch: run it in a Herdr pane split below this one` (cli.txt)
- `status --pane` without --watch → usage error exit 2, do_instead `norn status --watch`
- Fake Herdr (S1 test "inside Herdr: a pane split below the caller runs the cockpit"): records `open below <root> norn status --watch norn`, and with --interval 10s carries the interval. Green.
- Real Herdr (incidental): run inside a real Herdr session with HERDR_PANE_ID unset but HERDR_SOCKET_PATH set, it printed `{"opened":true,"runner":"herdr","pane_id":"wK:p1V"}`; Herdr shows the new pane labelled `norn`, cwd the throwaway repo. With no caller pane id it split the person's focused pane (another tab), not this session's. See note.
