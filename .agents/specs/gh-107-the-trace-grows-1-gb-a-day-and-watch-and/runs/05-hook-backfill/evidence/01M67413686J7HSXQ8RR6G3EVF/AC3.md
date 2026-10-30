# AC3 (B11): a run started after since → no day file scanned
- Slice test AC3 passes: backfill.json written by the intake ticks; brief starts a run after since; both following ticks open no day file (trace-read observer).
- Probe: before the upgrade simulation, ticks with backfill.json present and the run started after since; after backfill completion, every later tick opened `[]` day files.
- Extra: `norn inbox` and `norn status` never create backfill.json (only the tick backfills).
