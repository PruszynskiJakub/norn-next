# AC3 — PRD §15 noun tree and renamed rules
- .agents/PRD.md §15 "Commands (v1)" is a tier table: Core `norn status`, `norn story <verb>` (create, list, view, answer, approve, reject, update-branch, start, chat, edit, checkout, handoff, close, reopen), `norn run <verb>` (list, view, attach, rerun, cancel); Setup; Background; Agent protocol; Hidden.
- O1, O2, O5 name status/story/run verbs; MO5 → `story start`, BS9 → `story update-branch`, GR7 → `story close`, K2a → `config`, T5/T6 → `story checkout`/`story handoff`.
- S7 (line 167): "a running unit adopts a change only through `norn story edit <unit> --workflow <name> --at <step>` (journaled)".
- The lint covers the PRD and `.agents/SPEC-*.md` (HC rules); planted old names in the PRD fail it (AC1.md).
