# gh-343 handoff

## Goal

A workflow step opens with one head key (`agent:`, `check:`, `gate:`, a value-less verb, `use:`); agent skills become an optional `skills:` list; meanings and verdicts move to sibling `means:` / `verdict:` maps; `by:` picks the agent; `norn upgrade` rewrites old-wording files losslessly while old pins keep loading. The spec is refined and planned.

## Proof

- spec.md User Stories: 50 stories in six groups, confirmed by the owner. Story 41 amended in plan: the gate text fallback is `approve or reject <step>` (today's text), not the line agreed in refine.
- spec.md Plan: seams S1–S8, a coverage row for every story, two prefactors, decisions D1–D9, risks. Owner settled the open decisions in session (see Notes).

## Easy to miss

- **The loaded model stays the `type`-tagged union** (D1, owner's choice). Only the file format changes; the loader normalises new wording into the model. Model changes: `skills?: string[]`, `instructions` required (the orientation), gate `prompt` required. Edges keep `means`/`verdict` internally.
- One old→new translator in store over the `yaml` Document, shared by `norn upgrade` and the copy reads (pins, trace, record, branch files), so they always agree (D3).
- The old wording is refused only by the main-checkout reads (`loadWorkflows`, `loadWorkflow`); copy reads translate. Prefactor 1 makes the two reads explicit.
- Fallbacks in the translator: orientation = instructions → description → ``Use the `X` skill.``; gate text = prompt → description → `approve or reject <step>`; a routed reportable outcome without a meaning gets `step finished with outcome <o>` (today's brief fallback), so story 20 holds and the brief reads the same.
- The upgrade rewrite is byte for byte outside what it changes (D3a, owner): no re-wrapped folded/block scalar, no padded flow list (`[X]`); a scalar the library cannot keep as written refuses that file (file and line), never reflows it.
- A lost-record restart pins the branch file text verbatim (D4).
- Golden cases: rewritten once (skill → skills, fallbacks filled); decisions must stay byte-identical (D8).
- `by:` is still a name the owner may change before the build.

## Not proven yet

- Nothing built. The slices are not cut yet.

## Notes

- Owner decisions from the plan interview: keep the internal tagged model; fill in a missing meaning with the fallback; pin the branch text verbatim at restart; one gate fallback text everywhere (`approve or reject <step>`), story 41 amended.
- Spike (thrown away): the `yaml` Document API can rename keys in place, swap `type` for the head key in position, split a flow edge into `outcomes`/`means`/`verdict` and keep its trailing comment. Caveats: flow sequences come out padded (`[ X ]`) unless that option is off; a folded scalar keeps its style but gets re-wrapped. D3a forbids both; keeping scalar source text is the first thing the translator slice must prove.
- `norn upgrade` lists a refused file (unplaceable comment) in a new `workflows` report field and still exits 0 (D9).
- Design record gist (`quick.yaml`) shows the target wording.

## Resume

Slice the planned spec (norn-slice): prefactors first (the two reads, skill → skills in the model), then the translator against the shipped workflows as fixtures.
