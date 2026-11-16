## Goal
"Write your own workflow" in `docs/recipes.md` teaches a workflow author to write a shared file, `use:` it, route its named exits (with a counter) and copy steps with `like:`, and lists what is refused, without reading the code.

## Proof
| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | following "Write your own workflow" yields a workflow with a shared file, a named exit routed with a counter and a `like:` step that loads, and the section lists every refusal with wording that keeps a named exit apart from a check's `exits` | agent | QA (agent) — implement's live `norn doctor --json` run (`evidence/01-loads.txt`…`05-like.txt`); review checked each listed refusal against `packages/store/src/shared-workflow.ts` messages |
| the recipes show shared files, `use:`, exits, `like:` and refusals (user story) | an author learns the feature from the recipes without reading the code | agent | QA (agent), via AC1 |

- AC1 (the recipes example loads, and the section lists the refusals with wording that keeps a shared file's named exit apart from a check's `exits`): docs only. The section's examples, applied to a copy of the bundled `story` (`docs.yaml`: `ship` use step with `green`/`red`/`behind` named exits, `behind` routed with `stale_loop`; `test-merge`/`test-resolution` as `like: test`) plus `shared/ship.yaml`, load clean under the dev build's `norn doctor --json` in a throwaway repo, and `shared/` is not listed as a workflow. Evidence: `evidence/01-loads.txt`, `docs.yaml`, `ship.yaml`.
- Refusal wording checked against the loader's actual messages (shared-workflow.ts) and live: misspelt exit (`02-unknown-exit.txt`), missing shared file (`03-missing.txt`), `counters` in a shared file (`04-key.txt`), bad `like:` (`05-like.txt`).
- `bun run test` (1952 pass at review) and `bun run typecheck` green; `bun run docs:emit` leaves `docs/reference.md` unchanged.

## Easy to miss
- "Exit" has two meanings: the doc always says "named exit" for a shared file's `{ exit: <name> }` and "a check's `exits`" (exit code → outcome) for the other; the example deliberately maps exit code 3 → outcome `stale` → named exit `behind` to show the difference.
- The example avoids routes that would break the open-pr rule (no "enter `ci` from review").

## Not proven yet
- Nothing for this slice. The bundled and repo shared files (slices 05/06) were not on this base yet, so the example is a self-contained `ship` shared file, not one copied from the shipped set.

## Notes
- Review #1: approve, no findings; the refusal list matches the loader one for one (missing file, double use, clashes, unknown exit, nested use, workflow keys, route out of the file, use step in reset_on/base.verify, every bad like:), and unrouted named exit → `$stuck`, `start`/`base.step` entering at the file's start match `flattenWorkflowText`.
- Added a numbered step 3 (reuse steps) and three subsections under the recipe: Share steps between workflows, Copy a step with `like:`, What norn refuses; the pin sentence now says shared files are filled in at pin time too.

## Resume
QA (agent): follow the recipe in a throwaway repo with the dev build (`bun packages/cli/src/main.ts doctor --json`) and confirm it loads and the listed refusals fire.
