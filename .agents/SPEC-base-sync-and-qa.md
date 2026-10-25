# Spec: base sync and honest QA (norn v1.1)

Status: draft for review · Amends `.agents/PRD.md` · Fixes gap 1 (F8) and gap 5 (F30, F37) in `.agents/LIMITATIONS.md`

## 1. Why

Two gaps from the Todoist dogfood run would hurt a Scrum team more than they hurt one person:

1. **Stale story branches (F8).** A story branch is cut from the base at intake and never sees the base again. When a sibling story merges, the others fall behind; in the dogfood run a person merged `main` into story branches by hand four times, and conflict resolution after `$done` happened outside norn — invisible to receipts, the trace and `norn why`. A sprint with five stories against one base turns this into daily manual work.
2. **QA that can only say pass or fail (F30, F37).** QA has no outcome for "I could not check this here" (a browser criterion without a browser) and no way to pass while leaving a question for a person. Agents picked the closest wrong outcome (`partial`) or buried the question in `handoff.md`. "Never pass what you did not observe" is prose in a skill, not a rule the code enforces.

## 2. Topology this must fit

Business backlog lives in a tracker outside norn (Jira); norn never talks to it. Development lives in git, hosted on GitHub, GitLab or nothing at all (local files and branches only).

Therefore every rule below uses **git only** and must work with no host. The one host-dependent input is which ref is "the base":

- BS0 The **base branch** is config `base_branch` when set, otherwise `default_branch` discovered as today (`packages/store/src/base.ts`). It is never assumed to be `main` (old norn 0.6.0). The **base ref** of a story is `refs/remotes/<git_remote>/<base branch>` when the git remote exists, otherwise `refs/heads/<base branch>`. `open-pr` targets the base branch.

### 2.1 Prior art: old norn

The predecessor (`PruszynskiJakub/norn`) never brought a story branch up to date with its base: an agent merged the story branch into each slice right before merging that slice (`norn-merge` skill), and the owner dealt with drift from the base when merging the story PR. It always merged, never rebased or force-pushed, had no conflict detection and no limit on merge attempts. This spec keeps its merge-only rule and its conflict-resolution rules (BS5), adds what it lacked (detection, a CLI step, counters, re-entry), and keeps its post-incident guards (BS11, BS0). Slices meeting each other's changes is already covered: `integrate` rebases a slice onto the latest story branch under the K6 lock.

Note: a host-less mode (stories created from local files instead of remote issues) does **not** exist today — story keys must be `gh-N`/`gl-N` and intake reads issues (GR1, GR2). It is a separate spec; nothing here may make it harder.

## 3. Goals and non-goals

Goals:
- A story is brought up to date with its base by a workflow step, inside norn, with receipts — never by a person running `git merge` in a worktree.
- A story already waiting for a person (at a gate, or done and waiting for the merge) is sent back through update → test → qa when the base moved under it in a way that matters.
- QA reports a verdict per acceptance criterion as structured data; the CLI refuses an outcome that the verdicts do not support.
- Any agent step can leave a non-blocking note for a person that reaches the inbox and the story's last gate.

Non-goals (this spec):
- Updating a story from its base while its slices are running (only between steps where no unit of the story runs).
- Merging the story PR for the person (GR5 stays).
- Rebasing published story branches.
- Jira or any tracker integration; host-less intake; cost per story (gap 3, postponed).

## 4. Part A — Base sync

### 4.1 Facts

- BS1 Observe adds per story `story.base`:

  ```ts
  base?: {
    ref: string;            // BS0
    sha: string;            // tip of the base ref this tick
    merge_base: string;     // git merge-base story_head base_sha
    behind: number;         // commits in base not in story
    ahead: number;          // commits in story not in base
    conflicts: string[];    // paths that would conflict, [] when a merge would be clean
  }
  ```
  `conflicts` comes from `git merge-tree --write-tree --name-only --no-messages <story_head> <base_sha>` and is computed only when `behind > 0` and the pair (story head, base sha) changed since last tick (cache in `.agents/norn/trace/base.json`; the facts themselves are recorded in the trace as today, so `norn why` replays them).
- BS2 `norn doctor` requires git ≥ 2.38 (for `merge-tree --write-tree`) and refuses to start a heartbeat otherwise.

### 4.2 The `update` git action

- BS3 W2 gains a git action `update` (story units only, checked at unit start like `open-pr`, W8). In the story worktree it:
  1. refuses to run (`$stuck`, reason `worktree dirty`) if the worktree has uncommitted changes;
  2. takes the story's integrate lock (K6), so it never interleaves with a slice `integrate`;
  3. if the remote story branch is ahead of the local one and is a descendant of it (a person pressed "Update branch" on the host), fast-forwards to it first; if they diverged, merges it (BS3.3a); if that merge conflicts, `$stuck` with reason `story branch diverged from <remote>; merging it conflicts in <paths>`;
  4. if `behind == 0`: outcome `done`, no commit;
  5. otherwise `git merge --no-ff --no-edit <base_sha>` with message `Update <story> from <base> (<short sha>)` and the `Norn-Tick` trailer (so Q6 does not report it as a foreign commit), then pushes at the step boundary (S8, T7);
  6. on conflict: `git merge --abort`, outcome `conflict`, with the conflicting paths and `base_sha` in the classify receipt `detail`.
- BS3.3a **A person's push to the story branch is taken in, never lost** (dogfood D4). A person may push to the story branch at any time (a `$done` story included) while norn keeps committing locally. When a push of the story branch is rejected because the remote moved, and when `update` finds the branches diverged, norn fetches `<remote>/<branch>` and fast-forwards to it if it can, else merges it (`git merge --no-ff`, message `Merge <remote>/<branch> into <branch>`, norn's trailers incl. `Norn-Tick`), then pushes. A conflicting merge is aborted: the push stays a failed effect (Unblock item naming the paths) and `update` goes `$stuck`. Never rebase (BS4). The person's commit still moves the head the ready gate let through (F35 item).
- BS4 **Merge, never rebase.** The story branch is published (draft PR, team handoff T5), slice branches are cut from it (GR3), and the ready gate pins its head (F35). Rebasing would rewrite all three. GR4 is unchanged: only the CLI integrates and pushes.
- BS5 The `merge` skill gains a "base" mode: its brief carries the base sha, the conflicting paths and the instruction "merge `<base_sha>` into the story branch in this worktree, resolve, commit the merge; never rebase". Its resolution rules come from old norn's `norn-merge` skill:
  - **Resolve each conflict by intent.** For each hunk, find the sources on both sides: the commit messages, the story spec and slice acceptance criteria of this story, and the merged story that introduced the base change. Preserve both intents where possible. Where they are incompatible, follow this story's spec and note the trade-off in the merge commit message.
  - **Resolve to existing behaviour only.** When no resolution fits without new behaviour, abort the merge and report `norn stuck "<why>"` — the unit parks under Unblock with the reason (W7). Otherwise always finish the merge.
  - Run the slice/story check commands before reporting and fix what the merge broke; the `test` step after `update` re-checks anyway.
  On `done` the workflow returns to `update`, which now finds `behind == 0` (or a new, smaller gap if the base moved again).
  The agent's merge commit is not a foreign commit (Q6): a commit made during a run of the unit (from its first to its last receipt, open-ended while the unit runs or is parked on an ask, e.g. a permission prompt) is the agent's (dogfood C4).
  `norn done` in base mode is refused (`merge_unfinished`) unless the merge is concluded: no merge or rebase in progress, no unmerged path, the base sha an ancestor of HEAD, and no conflict marker in the conflicting paths or the files changed since the merge commit. The done receipt records `base_merge {sha, merge, head}`; `norn why` and `norn status` show the merge commit (audit).
  norn's own commits never conclude an agent's merge: while the worktree has `MERGE_HEAD`, a rebase, a cherry-pick or unmerged paths, norn commits nothing there (git cannot commit some paths mid-merge) and records why in the trace; its runs/ files go with the next commit after. A norn commit whose staged changes add conflict markers is refused (a failed `commit` effect, Unblock item), so nothing with markers is pushed (audit H1).
- BS5.1 **A deferred commit never takes the unit's turn** (dogfood D3). Observe reports the operation in progress per worktree (`worktree.in_progress`). While one is, the owed recovery commit is not decided at all (act could only defer it): the unit's other rules run as usual — an implicit ask on a second prompt mid-merge, `died`, `silent`, `stalled`, `timeout`. The commit follows once the merge is concluded.
- BS5.2 **Nothing with conflict markers is published** (dogfood D5). Before any push of a story or slice branch, norn looks at the files changed by the commits not yet on any `<remote>` ref (merge commits against their first parent). If one still holds both an opening `<<<<<<< ` and a closing `>>>>>>> ` marker line (with the label; a lone `=======` is a setext heading) at the head being pushed, the push is held: a failed `push` effect (`ok: false`, Unblock item) naming each file and the newest outgoing commit that changed it. A follow-up commit that removes the markers releases it; norn never rewrites the branch.

### 4.3 Re-entry when the base moves later

- BS6 New classified outcome `stale` (§10 table, rule: tick-decided from facts):

  | Step type | Classified outcome | Rule |
  |---|---|---|
  | gate (story unit) | `stale` | the unit waits at the gate and BS7 holds |

  It is reserved (W7) and applies only if the gate declares a `stale` route; otherwise no classification happens and only the inbox item (BS10) appears.
- BS7 A story is **stale** when `base.conflicts` is non-empty (default) or, with workflow field `base: { stale: behind }`, when `base.behind > 0`. `behind` suits repos whose host requires branches to be up to date before merge.
- BS8 Taking a `stale` route writes a `classify` receipt `{outcome: stale, rule: "base moved", detail: "<n> behind, conflicts: …"}`. Like every cycle (W4), the edge back must carry a counter; the default uses `stale_loop: { max: 10 }`: a stale re-entry is progress from outside, bounded by the number of sibling merges (dogfood C3).
- BS9 **After `$done`, before the merge.** The story unit is done but its PR is open (GR6 has not fired). A new verb `norn update <story>` re-enters the step named by the workflow field `base.step` (default: the first step with `action: update`):
  - allowed when the story unit is done with an unmerged PR, parked at a gate, or parked stuck, and this checkout holds the claim (T7); refused otherwise with `do_instead`;
  - writes a new receipt kind `update` `{from: <step or "$done">, to: <step>, reason: "person" }` before the state change (P6, S5);
  - re-entering from `$done` sets the unit back to running at `to`; the ready gate must then be passed again (the head changes, F35). The old approval no longer pins the head: `ready_head_sha` comes only from an `approve` receipt newer than the unit's last re-entry (`update`, `workflow`) (dogfood C5).
  It is never triggered by the tick on a done unit — a done unit only moves when a person says so.
- BS10 Inbox:
  - Check group, one item per story that is stale (BS7) and not routed by BS6: `gh-3 conflicts with main in a.ts, b.ts (4 behind)`, command `norn update gh-3`, id `stale:<story>:<base_sha>`.
  - The existing "Merge PR #N" item gains detail `behind main by N` and, when conflicting, its command becomes `norn update <story>`.
  - BS10.1 (dogfood D1): the `stale:*` item appears only where `norn update` is the next thing to do — the story unit parked at a gate without a `stale` route, or stuck in a step other than an `update` step and the step its `conflict` routes to (resolve). Never for an ask (a permission prompt parks the unit in any step), nor while the story is in update or resolve.
  - BS10.2 (dogfood D6): the F35 head-changed item compares the ready approval's head only with a PR fetched this tick or one seen after the approval; a PR remembered from before the approval is not compared.
  - PRs are fetched only on sync ticks. Each checkout keeps the last PR seen per story with its observation time (`.agents/norn/trace/pr.json`, fact `story.pr_seen`); the PR items (merge, BS11 retarget, F35 head changed) use it between syncs and in the read model (`norn inbox`, `status`), so they neither flicker nor go missing. Decide acts only on a PR fetched this tick (dogfood C1).

- BS11 **Merged means merged into the base.** GR6 cleanup fires only when the PR's base branch equals the story's base branch (BS0). A PR merged into any other branch parks the story with reason `remote: PR merged into <branch>, not <base>` (GR7) — the lesson from old norn 0.1.1, where a merge into the wrong base skipped story review. Retargeting a PR is reported as a Check item.

### 4.4 Default story workflow change

```yaml
  slices:   { type: slices, outcomes: { done: update, stuck: $stuck } }
  update:   { type: git, action: update,
              outcomes: { done: test, conflict: { to: resolve, counter: base_conflict_loop } } }
  resolve:  { type: agent, skill: merge, inputs: [spec, handoff],
              outcomes: { done: { to: update, means: "base merged into the story branch, conflicts resolved and committed" } } }
  # …test, qa, open-pr unchanged…
  human-qa: { type: gate, outcomes: { approve: open-pr, reject: { to: implement, counter: qa_loop },
                                      stale: { to: update, counter: stale_loop } } }
  ready:    { type: gate, outcomes: { approve: $done, reject: { to: implement, counter: ready_loop },
                                      stale: { to: update, counter: stale_loop } } }
counters: { …, base_conflict_loop: { max: 2, reset_on: update.done }, stale_loop: { max: 10 } }
base: { stale: conflict }
```

`update` sits after `slices` and before `test`, so story tests and QA always run against the current base.

**Amends W4: `reset_on`** (dogfood C3). A counter may declare `reset_on: <step>.<outcome>`; taking that edge resets it to 0, journaled with the advance (trace, commit message, handoff line). `base_conflict_loop` resets on `update.done`: it bounds attempts at one base move, so a long sprint of unrelated sibling merges never parks a healthy story, while a resolve that keeps failing on one move still exhausts it. `reset_on` must name a declared edge; validation still requires a counter on every cycle. Workflows without `slices` place it before their first check.

## 5. Part B — Honest QA

### 5.1 Criteria as data

- QV1 Slice frontmatter (and story frontmatter for story-level QA) gains an optional `criteria` list, written by the `slice` skill next to the prose Acceptance section:

  ```yaml
  criteria:
    - { id: AC1, verifier: test }
    - { id: AC2, verifier: agent, needs: [browser] }
    - { id: AC3, verifier: person }
  ```
  `needs` names capabilities the check requires (free strings; `browser` is the first one used). Decide never reads the prose (P8); it reads this list.

### 5.2 Verdicts

- QV2 `norn done` takes `--criteria <file>`: a JSON array validated against a new schema `CriteriaReport`:

  ```json
  [{ "id": "AC1", "verdict": "pass", "evidence": "evidence/<run_id>/ac1.txt" },
   { "id": "AC2", "verdict": "unverified", "reason": "no browser in this session", "how": "open /today, add 'buy milk p1', expect red flag" },
   { "id": "AC3", "verdict": "person", "how": "compare against Figma frame 12" }]
  ```
  Verdicts: `pass` (observed, evidence required), `fail` (repro in `findings`), `person` (needs a person's judgement or access), `unverified` (a machine could check it, this session could not; `reason` and `how` required). The report is stored in the `done` receipt (new optional field `criteria`).
- QV3 An agent step declares `criteria: required` to make `--criteria` mandatory; the default `qa` steps do.
- QV4 When the unit's frontmatter has `criteria`, the report must cover exactly those ids; a missing or unknown id is refused (`invalid_criteria`, exit 3) with the list in `do_instead`. Without frontmatter `criteria`, coverage is not checked and the trace records `criteria.unchecked_coverage`.
- QV5 **Outcomes are gated by the worst verdict.** An outcome edge may declare `verdict: <v>`. Order: `fail` > `unverified` > `person` > `pass`. An outcome with `verdict: v` may be reported only when the worst verdict in the report is `v`; otherwise `norn done` refuses (`outcome_contradicts_verdicts`) and names the outcome that matches. This turns "never pass what you did not observe" into a rule the code enforces.
- QV5a **`pass` needs the capability** (dogfood C2). Agents declare what their sessions can do in config: `agents.<name>.capabilities: [browser, …]` (default none). `norn done` refuses (`pass_without_capability`, exit 3) a `pass` verdict for a criterion whose `needs` are not all among the reporting agent's capabilities; `do_instead` says to report it `unverified` with `reason` and `how`. A person's earlier gate ruling (the brief's Rulings section) answers questions but never verifies a criterion: it judged the code as it was then, and a base merge or a fix may have changed it since.

### 5.3 The `unverified` outcome

- QV6 Default `qa` steps (story and slice):

  ```yaml
  qa:
    type: agent
    skill: qa
    criteria: required
    outcomes:
      pass:       { to: <next>,   verdict: pass,       means: "every criterion observed with evidence" }
      fail:       { to: implement, counter: qa_loop, verdict: fail, means: "a criterion fails; repro in findings" }
      partial:    { to: human-qa, verdict: person,     means: "criteria only a person can judge, evidence prepared" }
      unverified: { to: human-qa, verdict: unverified, means: "criteria this session could not check; how to check each one is in the report" }
  ```
  A workflow may instead route `unverified` to another agent step whose `agent`/`model` has the capability (e.g. a browser-equipped runner). The default routes to a person, because norn does not yet know which runner has which capability.
- QV7 The `human-qa` gate's inbox item and brief list the `person` and `unverified` criteria from the last QA `done` receipt with `reason` and `how` — the person sees what to check without opening a file.
- QV8 Trace and `norn trace` count `unverified` per capability in `needs`, so "we keep failing to verify browser criteria" shows up as data.

### 5.4 Notes for a person

- NT1 Every `norn done` accepts `--note "<text>"` (repeatable, optional `--note-criterion AC3`). Notes are stored in the `done` receipt (`notes: [{text, criterion?}]`). They never block and never change the route.
- NT2 Each note becomes a Check-group inbox item `note:<receipt_id>:<n>`: `QA note on gh-4/01 (AC3): …`, command `norn why gh-4/01 --receipt <id>`.
- NT3 Every story-level gate (`human-qa`, `ready`) lists the story's open notes in its inbox detail and brief. Approving that gate records the note ids in the `approve` receipt (`acknowledged_notes`); acknowledged notes leave the inbox. Rejecting leaves them open.
- NT4 The qa skill states when to use a note instead of `person`: the criterion passed as written, but the person may disagree with the reading (F37: whitespace inside backticks vs AC3).

## 6. Contract changes

| Contract | Change |
|---|---|
| `Workflow` schema | counter field `reset_on` (W4 amended); git action `update`; edge field `verdict`; agent step field `criteria`; workflow field `base: {stale, step}`; classified outcome `stale`; reserved word `stale` (W7) |
| `Facts` | `story.base` (BS1); `story.pr.base_branch` (BS11); `story.pr_seen` (BS10) |
| Config | `base_branch` (BS0); `agents.<name>.capabilities` (QV5a) |
| `Receipt` | new kind `update` (13 kinds); `done.criteria`, `done.notes`; `approve.acknowledged_notes` |
| Frontmatter | `criteria` on slice and story |
| New schema | `CriteriaReport` |
| CLI | `norn update <story>`; `norn done --criteria --note --note-criterion`; refusals `invalid_criteria`, `pass_without_capability`, `outcome_contradicts_verdicts` |
| Inbox | items `stale:*`, `note:*`; merge item detail; gate details |
| Skills | `merge` (base mode), `qa` (verdicts, report file, notes), `slice` (frontmatter `criteria`) |
| PRD | §5 glossary adds **verdict** and **note**; §10 table adds `stale`; §11 W2/W7; §12 adds BS0–BS10 after GR8 |

Every change ships with its tests, the emitted JSON schemas (`bun run schema:emit`) and updated templates in `packages/cli/assets/workflows/`. Pinned workflows of units already in flight are unchanged (S7); they get the new behaviour only via `norn workflow <unit> <name> --to <step>`.

## 7. Acceptance

Unit and replay tests (core, by replaying traces, X4):
1. Story behind with no conflict → `update` merges, one commit with `Norn-Tick`, no foreign-commit item, `done` → `test`.
2. Story behind with conflicts → `conflict` → `resolve` brief carries base sha + paths → `done` → `update` finds `behind == 0` → `test`.
3. `base_conflict_loop` exhausted → `$stuck` with reason.
4. Story waits at `ready`, sibling merge makes `conflicts` non-empty → `stale` → `update`; same with `stale: behind` and a clean merge.
5. Gate without a `stale` route → no classification, Check item `stale:*` only.
6. `norn update` on a done, unmerged story → `update` receipt, unit running at `update`; on a merged story → refused; without the claim → refused.
7. Remote story branch fast-forwarded by a person → `update` adopts it; diverged → `update` merges it (BS3.3a); diverged into a conflict → `$stuck` naming the paths. A rejected push of a `$done` story's branch takes the person's commit in by a merge and pushes.
7a. `resolve` agent reports `stuck` (no resolution without new behaviour) → `$stuck` with its reason, merge aborted, worktree clean.
7b. PR merged into a branch other than the base → no cleanup, story parked `remote: PR merged into …`; config `base_branch: develop` → `update` and `open-pr` use `develop`.
8. `norn done pass` with an `unverified` criterion → refused, `do_instead` names `unverified`; `norn done unverified` → `human-qa`, gate detail lists `how`.
9. Report missing a frontmatter criterion id → `invalid_criteria`.
10. `--note` on a pass → Check item; acknowledged by `ready.approve`; still open after `ready.reject`.
11. Host-less: with no git remote, BS0 uses `refs/heads/<base>` and cases 1–4 pass.

Sandbox dogfood (the verification gap 1 asks for):
- Three checkouts of the sandbox, each with its own claim holder (separate `heartbeat.json`), run three stories that touch the same files against one base. Merge them one by one. Pass when no person runs `git merge`/`git rebase` in a story worktree, every conflict resolution is visible in receipts and `norn why`, and each story reaches `ready` with `behind == 0`.
- One story's QA runs without a browser and must end at `human-qa` via `unverified`, with `how` shown in the inbox.
