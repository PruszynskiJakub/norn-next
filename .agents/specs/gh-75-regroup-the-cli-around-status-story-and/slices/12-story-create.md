---
id: gh-75/12
title: story create, with the remote's createIssue
depends_on: [ gh-75/03 ]
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: test }
  - { id: AC7, verifier: test }
  - { id: AC8, verifier: agent }
---

## Goal
A person starts a story from the terminal: `norn story create` creates the labelled, assigned issue on the remote and takes it in at once, or opens the remote's new-issue page with `--web`.

## Scope
Behaviour: B18, B19, B20, B21, B22, B23. Seams: S1 (fake remote, fake shell, interaction fake), S3 (remote contract). Out: starting the story (it is taken in, not started).

## Acceptance
- AC1 (B18) `remoteContract` covers `createIssue({title, body, labels, assignee})` and `newIssueUrl({labels})` on gh and glab over scripted CLIs and on the harness's `FakeRemote`. — verifier: test
- AC2 (B18) `norn story create --title "Fix login timeout" --workflow fix` → the fake remote records issue #K with labels `norn` and `norn:wf:fix`, assigned to the person; intake ran; it prints `gh-K`; the story appears in `norn status` as a new story and no step has started. `--body`/`--body-file` set the body. — verifier: test
- AC3 (B19) Interactive, `norn story create` prompts "Title:" and opens the editor for the body (interaction fake); an empty title creates nothing, exit 2. — verifier: test
- AC4 (B20) `norn story create` without `--title` under `--json` or with no TTY → usage error (exit 2), do_instead "pass --title"; nothing is prompted. — verifier: test
- AC5 (B21) `--workflow nope` → refused (exit 3) listing the available workflows; the fake remote records no create call. — verifier: test
- AC6 (B22) The fake remote failing on create → error naming the remote failure, do_instead `norn doctor`; no story is taken in and nothing is written locally. — verifier: test
- AC7 (B23) `norn story create --web --workflow spec` → the fake shell records the remote's new-issue URL with labels `norn` and `norn:wf:spec`; nothing is created. — verifier: test
- AC8 (B18, B23) Against a real GitHub test repository, `story create --title … --workflow …` creates the labelled, assigned issue and `--web` opens a pre-filled page. — verifier: agent (needs: remote)

## Checks
- `bun test packages/adapters packages/cli`
- `bun run typecheck`

## Notes
D3: RemotePort gains `createIssue` and `newIssueUrl`; the workflow name is checked before any remote call; intake is the same as `sync` (GR1). AC8 needs a remote the agent may write to; if none is available it reports unverified and a person checks it.
