# User-side probes during `norn watch --max-ticks 6` (watch_interval 2s, check `sleep 20`)
Dev build: `bun packages/cli/src/main.ts`, throwaway repo $TMPDIR/gh77-repro, fake `gh` on PATH, NORN_HOME_DIR=$TMPDIR/gh77-repro/home.

Check tick 01M61DVV937SR48Z0VWBCWCACG: tick.start 14:15:44.675Z → tick.end 14:16:05.144Z (duration_ms 20468). No tick in between.

| probe (UTC) | heartbeat.json last_tick_at | norn status heartbeat | norn inbox unblock | running item |
|---|---|---|---|---|
| 14:15:43 | 14:15:43.288Z | age 0s, down:false | — | test #1 (queued) |
| 14:15:51 | 14:15:43.288Z (unchanged) | age 8s, down:true | "no heartbeat on jakubpruszynski@mac for 8s — run `norn watch`" | test #1 (queued) |
| 14:15:58 | 14:15:43.288Z (unchanged) | age 15s, down:true | "no heartbeat on jakubpruszynski@mac for 15s — run `norn watch`" | test #1 (queued) |

`norn watch` was running the whole time (its pid alive; it later released claims normally).
