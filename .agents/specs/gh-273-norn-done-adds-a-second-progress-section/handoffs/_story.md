## Goal

Reproduce gh-273 (norn done adds a second Progress section when the handoff headings are level 3), confirm the cause and name the seam for a regression test. No fix.

## Progress


The loop script is kept outside the repo (scratchpad `loop.ts`); its body: for each level in `#`..`####`, write `<lvl> Goal / <lvl> Progress (- wrote the form) / <lvl> Resume` to a temp file, call `appendProgress(f, "implement#1 done: x")`, count `/^#+\s+Progress\s*$/gm` and check the line follows `- wrote the form`.

## Resume

Post the findings as the `## Reproduce` comment on issue 273 (blocked by the permission classifier in the first session), then report `norn done reproduced`.
