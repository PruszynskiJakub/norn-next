# AC2 — no printed command names an old verb
- `bun test` 1374/0: includes printed-commands.test.ts (sweeps every builder) and the harness check (`h.norn`, `h.tick`, `runChecked` throw on any stdout/stderr naming a removed verb) over every cli suite.
- The AC8 drive went through `h.norn`/`runChecked` for every command (brief, done, ask, stuck, status, cockpit model, story view, every pasted command, ticks): no removed verb was printed (the check would have thrown).
- Live `norn init` + `norn doctor` in a throwaway repo (AC2-init-doctor.txt): commands named are `norn doctor`, `norn status`, `norn sync`, `norn watch`; grep for the B5 list finds nothing.
