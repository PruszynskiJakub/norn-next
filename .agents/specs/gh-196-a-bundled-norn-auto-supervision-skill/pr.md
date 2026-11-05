## Summary

norn now ships two skills that let an agent in the main checkout supervise the stories a person names: `norn-fsd-round` takes each story through its current round, and `norn-fsd` takes it end to end across rounds. The supervisor's gate decisions, answers, reruns and round starts go through the person's own commands with `--delegated --reason`. norn records them as delegated, with the reason, and shows them apart from the person's own decisions.

```text
person: "use norn-fsd on gh-201 gh-202"
  supervisor (main checkout, the only one who talks to the person)
    checks heartbeat.up in `norn status --json`; false → "! norn watch" escalation
    subagent per story (foreground)
      loop: norn story wait <story> --until gate --timeout 5m
            read story view / run view --json
            settled by spec/repo/issue → norn story approve|reject|answer … --delegated --reason "fsd: …"
            glitch / flake / exhausted loop → one norn run rerun [--step] [--reset] --delegated --reason
            anything reserved to the person → escalate to the supervisor
      round ends → report   (norn-fsd: pick next workflow → story edit --workflow --delegated --reason)
    one report for all stories
```

```diff
 receipt header (approve, reject, answer, unstick, round, …)
   by: human
+  delegated: true          # optional; absent = the person's own (decide unchanged)
 answer / round receipts
+  comment: "<reason>"      # approve/reject/unstick already had it
```

How it shows up: `run list` / `run view` show `approve — delegated (supervisor): <reason>`. `story view` gains a `## Delegated (N)` section. `status` adds `Delegated by a supervisor: gh-1 2 delegated`, and `status --json` gains `delegated_counts` and `heartbeat`. A delegated decision is never an inbox item.

## Evidence

The latest `test` check (attempt 7, exit 0) ran the unit tier, the integration tier and the typecheck. The S1 tests are in `packages/cli/test/integration/delegated.test.ts`. The S2 tests are in `packages/cli/test/unit/assets.test.ts` and `test/repo/docs.test.ts`. The quick workflow has no QA step, so nobody has run a supervised delivery yet (see the last entry).

- **B1** both skills shipped with the others
  **Before:** did not exist.
  **After:** assets › "exactly the skills of §16 are shipped" now lists `norn-fsd` and `norn-fsd-round`. `init`, `doctor` and `upgrade` work from that list, and their existing tests cover it.
- **B2** never in a unit worktree
  **Before:** did not exist.
  **After:** `--delegated` run inside a unit worktree → exit 3 `delegated_in_unit` (delegated.test › "a delegated command inside a unit worktree is refused"). The skill stops on `.norn-unit`, and an assets term checks for that.
- **B3–B20, B24–B33, B35–B45** the supervisor protocol (named stories, one supervisor, foreground subagents, the watch check, allowed and forbidden commands, gate checks, escalations, round choice, release, flakes, report)
  **Before:** a different ad-hoc prompt for each delivery.
  **After:** assets › "norn-fsd-round states the supervisor protocol" and "norn-fsd links norn-fsd-round and adds the round choice and the round start" check each item's terms. Other checks: every `--until` a skill prints parses as a `story wait` condition (B5); every `norn …` command and flag in the bundled skills exists (docs lint, B16); `norn-fsd-round` is loadable by a model and `norn-fsd` is person-only (D6). B8/B9: delegated.test › "heartbeat.up says whether a watch ticks here" shows never ticked → false, a tick → true, stale → false.
  These tests only check what the text says. Whether an agent follows it is the QA delivery below.
- **B21** delegated decisions are marked, the person's are not
  **Before:** a supervisor's approve was recorded as the person's.
  **After:** `run list` shows the gate row with `delegated (supervisor): <reason>`, and `run view` marks it in the trace. Delegated reject and a delegated rerun after `run cancel` are marked too. The person's own approve shows no mark (delegated.test, 4 tests; human.test › mailbox approve `--delegated`).
- **B22** shown apart in story view and status
  **Before:** did not exist.
  **After:** `story view --json` `delegated` lists `{round 1, review, approve, "fsd: CI green on the head, clean diff"}, {round 1, $done, round, asks, …}` and the markdown has `## Delegated (2)`. A story without any shows no section. `status --json` `delegated_counts` = `{gh-1: 2, gh-2: 1}`, and the inbox groups do not contain "delegated".
- **B23** a reason is required
  **Before:** did not exist.
  **After:** each of the five commands with `--delegated` and no `--reason` → exit 2 `reason_required`. `story edit --workflow --reason` outside a round start → usage error.
- **B34** the round's choice is recorded with its reason
  **Before:** did not exist.
  **After:** `story edit gh-1 --workflow asks --delegated --reason "fsd: one seam, no contract change"` → `run list` shows `round 2 · asks — delegated (supervisor): fsd: one seam, no contract change`, and `run view --json` has `delegated_round.delegated_reason`.
- **QA delivery** (verifier: person, from the Plan)
  **Not shown:** nobody has supervised a story with `norn-fsd` yet. To check: in a throwaway repo, ask an agent in the main checkout to "use norn-fsd on <one small story>". Judge the run against the protocol: no forbidden command run, every delegated decision has a reason, escalations come one at a time with the story named, and one report at the end.

Review notes left for a later round (non-blocking, from review#9):
- the flake-rerun guard ignores uncommitted edits a cancelled implement left;
- no rule for a gate that is decided but not yet applied;
- a whitespace-only `--reason` is dropped outside a round start;
- SK3 does not name `story edit --auto|--manual` or the `gh` actions.

## Merge danger

**Door:** two-way: `delegated` and `comment` are optional additive receipt fields. decide ignores them, and old receipts still validate. The one thing a revert leaves behind: receipts already written with `delegated: true` or an answer/round `comment`. The old schema refuses these extra fields, so their units would read as corrupt (S2). This happens only where a supervisor ran before the revert.

**Blast radius:** small: only someone who runs a supervisor or passes `--delegated` notices. `status --json` gains `delegated_counts` and `heartbeat` (additive). After `norn upgrade`, a running unit worktree on the old skill set counts as drifted, as when `norn-retro` was added.
