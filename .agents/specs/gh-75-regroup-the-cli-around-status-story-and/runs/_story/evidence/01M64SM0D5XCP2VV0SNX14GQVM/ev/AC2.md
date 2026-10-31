# AC2 — plugin actions call the new commands
- plugins/herdr/herdr-plugin.toml 0.4.0: actions open (open.sh), next (next.sh), pick (pick-open.sh); pane pick (pick.sh). The separate cockpit pane/action is gone; `open` is the cockpit-below action.
- next.sh runs `"$NORN" run attach --next --json`; open.sh runs `"$NORN" status --watch --pane --json`; pick.sh runs `"$NORN" status --watch`.
- Observed by running the scripts (AC4-norn-calls.log): next.sh → `run attach --next --json`; open.sh → `status --watch --pane --json`; pick.sh → `status --watch`.
- Repo test covering the manifest and next.sh with stubs: green in the full suite.
