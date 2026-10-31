# AC1 (B3) shipped norn skill never-edit rule
packages/cli/assets/skills/norn/SKILL.md:67 and the copy `norn init` (dev build) wrote into a fresh repo under $TMPDIR (.agents/skills/norn/SKILL.md:67):
> - Never edit anything under `runs/`, or the generated top of handoff.md. The repo's workflows (`.agents/workflows/`) and config (`.agents/norn.config.yaml`) are ordinary repo files: change them when the step asks for it. ...
Only `runs/` and the generated top of handoff.md are off limits; no trace or other norn path named.
Lint: test/repo.test.ts "the new layout in product docs (gh-110 B3, B22)" passes (tests.txt).
