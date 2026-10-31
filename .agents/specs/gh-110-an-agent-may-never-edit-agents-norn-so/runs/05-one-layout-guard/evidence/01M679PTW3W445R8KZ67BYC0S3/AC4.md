# AC4 (B20) — doctor reports the layout
Old layout: `norn doctor` → "norn doctor: 1 check failed (layout) / FAIL layout old layout / ! config: … / → norn migrate / · other checks skipped", exit 1. `norn doctor --repo --json` → {ok:false, repo:{layout:{ok:false, layout:"old", do_instead:"norn migrate", code:"old_layout"}}}, exit 1.
Both layouts: doctor → "FAIL layout old and new layout both present … → keep one … then run norn migrate in <root>", exit 1; --repo --json code both_layouts, exit 1.
Nothing moved (sha snapshots). Evidence: AC1-AC3-AC5-old.txt, AC2-AC4-both.txt.
Note (review #1): plain doctor skips the machine group on old/both layout ("other checks skipped").
