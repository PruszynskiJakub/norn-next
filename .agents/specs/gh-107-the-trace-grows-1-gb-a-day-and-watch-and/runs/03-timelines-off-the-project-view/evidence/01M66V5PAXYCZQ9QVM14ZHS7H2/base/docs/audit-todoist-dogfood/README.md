# Audit: norn dogfood on a Todoist clone (2026-10-23)

norn (PR #1) delivered 4 stories of a Todoist clone in `PruszynskiJakub/norn-sandbox-todoist`, driven in manual mode by Claude Code subagents, with the orchestrator acting as the person at gates.

| File | What it is |
|---|---|
| [audit-pack.md](audit-pack.md) | Main report: per-unit timelines, counts, §19 success criteria, observability scorecard, verified friction, top-10 improvements, and **Audit conclusions** at the end |
| [audit-rework.md](audit-rework.md) | Deep-dive on the two HIGH defects (rework briefs missing the real reason): reconstruction, root cause, fix design |
| [verify-mustfix.md](verify-mustfix.md) | Verification of the must-fix observability changes against the real sandbox |
| [friction.md](friction.md) | Raw friction log F1–F37 captured during the run |
| [brief-gh2-03-rework.md](brief-gh2-03-rework.md) | The exact brief an agent received after a gate rejection (evidence for F31) |

Fixes from this audit are on `norn-v1` (PR #1): `fa6a184` (rework briefs) and `f3138a1` (trace timeline, durable records, PR facts, inbox/why).
