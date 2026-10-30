# AC4 — plugin actions in real Herdr (herdr 0.9.5, HERDR_ENV=1)
Setup: throwaway repo $TMPDIR/qa75/repo, `norn init` by the dev build; NORN_BIN = wrapper running `bun packages/cli/src/main.ts` and logging calls; HERDR_PLUGIN_CONTEXT_JSON = {"focused_pane_cwd": repo}.

Observed:
- next.sh with the real herdr: dev norn `run attach --next --json` refused `{"code":"nothing_to_attach","do_instead":"norn status"}` (exit 3); next.sh exited 0 and showed a Herdr toast "norn — No agent waits for you; run: norn status".
- open.sh: `status --watch --pane --json` split this agent's pane (pane w9E:p2, cwd = the repo, no focus). The split's shell then ran bare `norn status --watch`, which resolved to the released norn 0.11.1 on PATH (no `--watch` yet) → "Unknown option '--watch'". Expected until a release carries the new surface; the split does not honour NORN_BIN. Pane closed.
- pick.sh in a real Herdr split (NORN_BIN, NORN_COCKPIT_DIR set): the cockpit rendered ("norn status · repo  nothing needs you … no stories yet", footer "/ filter · ? keys · q quit"; AC4-pick-pane.txt); `q` quit it with exit 0 (no error prompt). Pane closed.

Not observed:
- The actions invoked through Herdr's plugin system with the plugin linked from this branch: the installed `norn` plugin (github @f08f415) is the person's live one, and the Herdr server's action env has no NORN_BIN, so the actions would run released norn 0.11.1, which lacks `run attach` and `status --watch`. Relinking would replace the person's plugin; not done.
- next's success path (focusing a live agent pane of a Your turn item).
- pick-open.sh (opens a focused overlay in the person's session through the installed plugin's pick entry).

How to check: once a norn with this surface is installed on PATH (or a dev build exported as NORN_BIN in the Herdr server env), `herdr plugin link <this worktree>/plugins/herdr` (after `herdr plugin uninstall norn`), then from a pane in a norn repo invoke `herdr plugin action invoke open --plugin norn` (cockpit split below the focused pane), `pick` (popup cockpit), `next` with nothing waiting (toast) and with a Your turn item whose agent pane is live (focus moves to it). Restore with `herdr plugin install PruszynskiJakub/norn-next/plugins/herdr`.
