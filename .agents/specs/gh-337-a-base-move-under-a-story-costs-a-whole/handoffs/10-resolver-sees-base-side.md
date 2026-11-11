### Goal

A resolving agent's brief lists, for each conflicting path, the base commits since the merge base that touched it, the story that landed each (its `Norn-Story` trailer) and that story's `spec.md` / `pr.md` on the base, so it resolves by both sides' intent (the `base_side` step input).

### Proof

Review #1: approved, no blocking findings. Traceability (each test read and seen to assert its item):

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | brief lists per conflicting path each base commit since the merge base that touched it: sha, subject, story from its `Norn-Story` trailer (squash's last block), spec.md / pr.md paths on the base | test | `packages/cli/test/integration/base-side.test.ts` › "the brief lists the base side per conflicting path, before and during the resolver's merge"; `packages/adapters/test/contract/git.ts` › "log limited to paths lists only the commits that touched them; a squash commit's trailers are its last block" |
| AC2 | a conflicting base commit with no story trailer is listed with its subject and no story | test | same integration test (`hand fix on main`); `packages/core/test/unit/base-sync.test.ts` › "2b: a resolve step with the base_side input: …" |
| AC3 | the brief's base-update section shows the base side | test | `packages/core/test/unit/base-sync.test.ts` › "2b: a resolve step with the base_side input: …" (before the resolve guidance; hidden when the step does not declare it) |
| AC4 | shipped story and quick (both copies) `resolve` takes `base_side` and validates | test | `packages/cli/test/unit/assets.test.ts` › "story's and quick's resolve take the base side of each conflict"; `test/repo/process.test.ts` › "story's and quick's resolve take the base side of each conflict, as the shipped copies do"; existing per-file validation tests |
| AC5 | bundled norn-merge skill tells the resolver to read the base side first | agent | QA (agent) — review read `packages/cli/assets/skills/norn-merge/SKILL.md` "Read the base side first" paragraph: present |

- `bun run test` (1760 pass) and `bun run typecheck` green at review; the integration test and the contract test pass locally under `bunfig.integration.toml`.

### Easy to miss

- The base side is gathered in the cli (`packages/cli/src/runtime/base-side.ts`, called from `commands/brief.ts`) from the entering classify-conflict receipt's `base` (sha, conflicts); merge base is `HEAD` vs the base sha, and HEAD is still the story side while the resolver's merge is in progress, so the same list shows then.
- `renderBrief` shows it only when the step declares `base_side`, even if the caller passes it.
- Trailers come from git's own trailer parsing (`%(trailers:only)`), which reads the message's last trailer block: that is what makes a squash commit's story come out.
- Spec path falls back to `story.md` (older spec folders); each of spec / pr is null when the base lacks it.

### Not proven yet

- AC5 (agent verifier) goes to QA; review found the paragraph in place.
- Full integration tier not run locally; CI runs it.

### Notes

- `GitPort.log` gained an optional `paths` argument (`git log <range> -- <paths>`) rather than a new port method. Slice 07 (light path) also adds commits-per-path to the git port; whichever lands second should reuse one of them.
- Only `resolve` takes `base_side` in the shipped workflows, as the spec asks; `sync-resolve` (the first sync's resolver) was left as is — a candidate for later.
- Review minor note (not rework): a trailer-less commit is labelled `no story (made outside norn)`, which is wrong for agent commits of a story landed by merge commit rather than squash; findings file has it.
- No commit cap per path: every base commit since the merge base that touched the path is listed, as AC1 says.
- If git fails while gathering (e.g. base sha missing locally), `norn brief` fails rather than hiding it; the base sha is the fetched base tip, so this should not happen.

### Resume

Review approved; next is the slice's QA.
