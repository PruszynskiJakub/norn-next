# gh-343 handoff

## Goal

A workflow step opens with one head key (`agent:`, `check:`, `gate:`, a value-less verb, `use:`); agent skills become an optional `skills:` list; meanings and verdicts move to sibling `means:` / `verdict:` maps; `by:` picks the agent; `norn upgrade` rewrites old-wording files losslessly while old pins keep loading. Refined, planned and sliced.

## Proof

- spec.md User Stories: 50 stories, confirmed by the owner (story 41 amended in plan: gate fallback `approve or reject <step>`).
- spec.md Plan: seams S1–S8, coverage for every story, prefactors, decisions D1–D9, risks. Checked against this base (c1f69852cc7a): the named reads, `validateWorkflowDefinition`, shipped workflows and golden cases are as the plan describes.
- slices/01–10: every user story is cited by some slice's acceptance; slice criteria copied into spec.md's frontmatter `criteria` as `NN.ACk`.

## Easy to miss

- **The loaded model stays the `type`-tagged union** (D1). Only the file format changes; the loader normalises new wording into the model.
- One old→new translator in store (D3) shared by `norn upgrade` and the copy reads. Byte for byte outside what it changes (D3a): no re-wrapped scalar, no padded flow list; a scalar it cannot keep refuses the file.
- Slicing is expand–contract: slice 04 accepts the new wording while the old still loads everywhere; fixtures and shipped files move (05, 06, 07); only slice 09 refuses old wording in the main checkout. Refusing earlier breaks ~80 test files.
- Fixtures that are *about* old wording (pins, branch files, upgrade input) stay old.
- Golden decisions must stay byte-identical (D8); a diff is a bug.
- `by:` is still a name the owner may change before the build.

## Not proven yet

- Nothing built. Slice 03 must first prove the translator keeps scalar source text (D3a); if the `yaml` library cannot, that is a replan, not a looser criterion.
- Slice 04 is the largest; the person may split it (head keys vs routes) at the gate.

## Notes

- Slices: 01 two reads (prefactor) · 02 skills list + brief lines · 03 translator · 04 new-wording loader (expand; deps 02, 03) · 05 shipped workflows, repo copies, schema (dep 04) · 06 cli integration fixtures (dep 04) · 07 other fixtures (dep 04) · 08 `norn upgrade` rewrite (deps 03, 04) · 09 refuse old wording in main checkout (contract; deps 01, 05, 06, 07, 08) · 10 docs (dep 05).
- Critical path 4 slices: 03 → 04 → 05 → 09 (or 03 → 04 → 08 → 09, 02 → 04 …). Startable at once: 01, 02, 03.
- The cli integration and e2e tiers run only in CI; slices whose tests live there (06, 08, 09) name `bun run test` + typecheck locally and rely on CI.
- Owner decisions from the plan interview: internal tagged model; missing meaning filled with the fallback; branch text pinned verbatim at restart (D4); one gate fallback text everywhere.
- Design record gist (`quick.yaml`) shows the target wording.

## Resume

Person reviews the Plan and slices/01–10 at approve-plan; then slices 01, 02, 03 start in parallel.
