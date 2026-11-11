---
id: gh-337/14
title: The resolver can ask with the merge kept in progress
depends_on: [ gh-337/03, gh-337/05, gh-337/06, gh-337/08, gh-337/09, gh-337/10 ]
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: agent }
---

## Goal
A resolving agent that needs a person's decision can `norn ask` while the merge stays in progress in its worktree; the answer resumes the same resolve, and a watch restart or a handoff never loses the partial resolution.

## Scope
User stories: the resolver can ask with the merge in progress; the answer resumes resolve with the merge still in progress; a clean watch exit keeps that story's claim and is never blocked; handoff refused; abort and `norn stuck` stay available; norn-merge says when to ask and when to abort. Seams: S2, S3. Out: the base side (10).

## Acceptance
- AC1 Given a resolve step's brief, then its base-update section says the agent may `norn ask` with the files, what each side wants and the decision needed, keeping the merge in progress, and that aborting and `norn stuck` remain for a merge it cannot understand. — verifier: test
- AC2 Given a resolve step that asked with a merge in progress, when a person answers, then the same resolve step resumes with the merge still in progress in the worktree. — verifier: test
- AC3 Given such a story waiting at an ask with a merge in progress, when `norn watch` exits cleanly, then the exit is not blocked and that story's claim is kept (not released), while other stories' claims are released as usual. — verifier: test
- AC4 Given the same story, when a person runs `norn story handoff`, then it is refused with code `merge_in_progress` and a `do_instead` to answer the question or unstick the step first. — verifier: test
- AC5 Given a resolve step that aborts the merge and reports `norn stuck`, then it escalates as today. — verifier: test
- AC6 The bundled `norn-merge` skill says when to ask (both intents valid and a person must choose) and when to abort (the merge cannot be understood). — verifier: agent

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
D14. Starts after the last slices of changes 1–5 (03, 05, 06, 08, 09, 10), the order the person asked for. Edit the skill in its bundled copy only. Claim release code is also touched by slices 01 and 03; a conflict is resolved at merge.
