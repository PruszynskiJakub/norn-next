## Summary

Workflow authors now write each step with one head key that says what happens. An agent step's skills become an optional list. Meanings and verdicts move out of the routes into sibling maps, and `by:` picks the agent. Old-wording files in the main checkout are refused, and `norn upgrade` rewrites them without losing anything. Old pins and story-branch files still load through the same translation, and decide makes the same decisions.

```diff
 implement:
-  type: agent
-  skill: norn-implement
-  instructions: Build the slice test-first.
-  agent: codex
+  agent: Build the slice test-first.
+  skills: [norn-implement]
+  by: codex
   outcomes:
-    done: { to: review, means: "the slice is built", verdict: pass }
+    done: review
+  means:
+    done: the slice is built
+  verdict:
+    done: pass
 tests:
-  type: check
-  run: bun run test
+  check: bun run test
 open:
-  type: git
-  action: open-pr
+  open-pr:
```

```
load workflow text (read kind)
  checkout: main checkout .agents/workflows/ ─ old wording? → refuse, do_instead: norn upgrade
  copy:     pin / story-branch file          ─ old wording? → translate (the same code as norn upgrade) → load
```

## Evidence

QA #2 ran on the whole story at 3af53e1, after the CI fix and review #2: 46 criteria pass, 0 fail, 1 is for a person to judge and 6 are unverified because they need a remote or CI (listed at the end). Full table: [report.md](evidence/_story/01M7JPBT006V69R487APS2FRV7/report.md). Since 3af53e1 only norn's own commits and the handoff have moved.

**Writing a step**

- **Agent step headed `agent: <orientation>`, other keys beside it**
  **Before:** `type: agent` + `skill:` + `instructions:`. **After:** the step loads with every sibling key ([04.AC1](evidence/_story/01M7JPBT006V69R487APS2FRV7/04.AC1.md)).
- **Check step headed `check: <command>`; gate headed `gate: <what the person decides>`**
  **Before:** `type: check` + `run:`, `type: gate` + `prompt:`. **After:** both load, and the shipped files use them ([04.AC1](evidence/_story/01M7JPBT006V69R487APS2FRV7/04.AC1.md), [05.AC1](evidence/_story/01M7JPBT006V69R487APS2FRV7/05.AC1.md)).
- **Built-in steps as value-less verbs; a verb with a value refused**
  **Before:** `type`/`action` pairs. **After:** all six verbs load to the same kind with the same outcomes, and `open-pr: now` is refused ("`open-pr:` takes no value") ([04.AC2](evidence/_story/01M7JPBT006V69R487APS2FRV7/04.AC2.md)).
- **Two head keys or none refused, naming the step**
  **Before:** did not exist. **After:** refused at load ([04.AC3](evidence/_story/01M7JPBT006V69R487APS2FRV7/04.AC3.md)).
- **`like` inherits the head key; a different one is refused**
  **After:** both cases observed ([04.AC4](evidence/_story/01M7JPBT006V69R487APS2FRV7/04.AC4.md)).
- **`use:` and shared `{ exit: … }` routes unchanged**
  **After:** shared steps load as written and their exits still route ([04.AC11](evidence/_story/01M7JPBT006V69R487APS2FRV7/04.AC11.md)).

**Agent steps: orientation, skills, agent**

- **Missing or empty orientation refused**
  **After:** refused, naming the step ([04.AC5](evidence/_story/01M7JPBT006V69R487APS2FRV7/04.AC5.md)).
- **`skills:` optional; a skill named twice refused**
  **Before:** exactly one skill was required. **After:** a step without `skills:` loads; a duplicate is refused ([04.AC6](evidence/_story/01M7JPBT006V69R487APS2FRV7/04.AC6.md)).
- **`unknown_skill` for each listed skill**
  **After:** the same refusal as before, once for each missing or invisible skill ([02.AC4](evidence/_story/01M7JPBT006V69R487APS2FRV7/02.AC4.md)).
- **Brief with one, two or no skills**
  **Before:** always "Use the `X` skill.". **After:** "Use the `norn-implement` skill.", "Use the `norn-implement` and `norn-tdd` skills.", and with none only the orientation ([02.AC1](evidence/_story/01M7JPBT006V69R487APS2FRV7/02.AC1.md), [02.AC2](evidence/_story/01M7JPBT006V69R487APS2FRV7/02.AC2.md), [02.AC3](evidence/_story/01M7JPBT006V69R487APS2FRV7/02.AC3.md)).
- **Refine step still recognised by its skills**
  **After:** decide finds the refine step from its `skills` list ([02.AC5](evidence/_story/01M7JPBT006V69R487APS2FRV7/02.AC5.md)).
- **`by:` picks the configured agent, falling back to the default**
  **Before:** a per-step `agent: <name>`. **After:** both the named agent and the fallback observed ([04.AC7](evidence/_story/01M7JPBT006V69R487APS2FRV7/04.AC7.md)).

**Outcomes, meanings and verdicts**

- **`outcomes:` as a plain map; `means:` / `verdict:` beside it; brief finish lines unchanged**
  **After:** `outcome: target` and `{ to, counter }` load with the sibling maps, and each finish line renders its meaning as before ([04.AC8](evidence/_story/01M7JPBT006V69R487APS2FRV7/04.AC8.md)).
- **A routed reportable outcome with no meaning refused; overridable routes exempt**
  **After:** refused, naming the step and outcome; `silent`/`died`/`timeout`/`stalled`/`ask`/`stuck` need none ([04.AC9](evidence/_story/01M7JPBT006V69R487APS2FRV7/04.AC9.md)).
- **Stale or misplaced `means`/`verdict` refused**
  **After:** refused for an unrouted outcome, on a non-agent step, and inside an edge ([04.AC10](evidence/_story/01M7JPBT006V69R487APS2FRV7/04.AC10.md)).

**The old wording**

- **Every reader names its read kind; today's file loads the same**
  **After:** checkout readers ask for `checkout`, pin/branch/trace/record readers for `copy` ([01.AC2](evidence/_story/01M7JPBT006V69R487APS2FRV7/01.AC2.md)); an old file read as a copy loads equal to its translation ([04.AC12](evidence/_story/01M7JPBT006V69R487APS2FRV7/04.AC12.md), [04.AC13](evidence/_story/01M7JPBT006V69R487APS2FRV7/04.AC13.md)). The trace, record and restart integration tests are unverified until CI ([01.AC1](evidence/_story/01M7JPBT006V69R487APS2FRV7/01.AC1.md)).
- **Main-checkout old wording refused, `do_instead` names `norn upgrade`; mixed steps too**
  **Before:** loaded. **After:** ``written in the old wording: step 'reproduce' (type, skill, instructions, means inside an edge); run `norn upgrade` to rewrite it and commit``, exit 3 ([09.AC1](evidence/_story/01M7JPBT006V69R487APS2FRV7/09.AC1.md), [09.AC2](evidence/_story/01M7JPBT006V69R487APS2FRV7/09.AC2.md)).
- **doctor: one issue per old file**
  **After:** each old workflow gets one FAIL line naming `norn upgrade` ([09.AC3](evidence/_story/01M7JPBT006V69R487APS2FRV7/09.AC3.md)).
- **No new round from an old file; the inbox names it**
  **After:** `norn story create --workflow <old>` is refused before anything is created. `story edit` and intake need a remote: unverified, check `integration/old-wording.test.ts` in CI ([09.AC4](evidence/_story/01M7JPBT006V69R487APS2FRV7/09.AC4.md)).
- **Story in flight on an old pin finishes untouched**
  **After:** a copy read loads the old text with its bytes and hash kept. Driving a round to its end needs a remote: unverified, check `old-wording.test.ts` › "the pin loads, its text and hash stay…" in CI ([09.AC5](evidence/_story/01M7JPBT006V69R487APS2FRV7/09.AC5.md)).
- **Lost-record restart pins the old branch file verbatim**
  **After:** the copy read keeps source and hash (the same text read as `checkout` is refused). `norn story checkout` not driven: unverified, check `takeover-record-lost.test.ts` › "an old-wording workflow file on the branch…" in CI ([09.AC6](evidence/_story/01M7JPBT006V69R487APS2FRV7/09.AC6.md)).
- **New units pin the new wording**
  **After:** observed ([09.AC7](evidence/_story/01M7JPBT006V69R487APS2FRV7/09.AC7.md)).
- **Same decisions in either wording**
  **After:** all 139 golden cases' `decisions` are byte-identical to origin/main (files renamed because the embedded workflow moved) ([02.AC6](evidence/_story/01M7JPBT006V69R487APS2FRV7/02.AC6.md)).

**norn upgrade**

- **Rewrites and stages old files in workflows/ and shared/; each loads to the same workflow**
  **After:** 9 files rewritten and staged with the config, exit 0; old file and its rewrite load deep-equal ([08.AC1](evidence/_story/01M7JPBT006V69R487APS2FRV7/08.AC1.md), [04.AC12](evidence/_story/01M7JPBT006V69R487APS2FRV7/04.AC12.md)).
- **Comments, key order and scalar styles kept; edge comments stay on the outcome's line**
  **After:** the shipped files and release.yaml translate byte for byte to the expected files ([03.AC1](evidence/_story/01M7JPBT006V69R487APS2FRV7/03.AC1.md), [03.AC2](evidence/_story/01M7JPBT006V69R487APS2FRV7/03.AC2.md), [03.AC5](evidence/_story/01M7JPBT006V69R487APS2FRV7/03.AC5.md)). A rewrite that would load differently is refused at its step: store test `wording.test.ts` › "a rewrite that would load differently… is refused at its step" (added after review #1).
- **An unplaceable comment refuses only that file**
  **After:** `odd.yaml:5: this comment has no line to sit on…`, the file byte-identical, the other 9 rewritten, exit 0 ([03.AC7](evidence/_story/01M7JPBT006V69R487APS2FRV7/03.AC7.md), [08.AC2](evidence/_story/01M7JPBT006V69R487APS2FRV7/08.AC2.md)).
- **`skill:` → `skills: [X]`, instructions become the orientation word for word; `agent: <name>` → `by:`**
  **After:** observed ([03.AC3](evidence/_story/01M7JPBT006V69R487APS2FRV7/03.AC3.md), [03.AC6](evidence/_story/01M7JPBT006V69R487APS2FRV7/03.AC6.md)).
- **Fallbacks: no instructions → description or "Use the `X` skill."; no gate prompt → description or `approve or reject <step>`**
  **After:** observed, a blank orientation counting as missing ([03.AC4](evidence/_story/01M7JPBT006V69R487APS2FRV7/03.AC4.md)).
- **A second run changes nothing; all-new files untouched**
  **After:** idempotent, and nothing rewritten or reported for a new-wording repo ([03.AC8](evidence/_story/01M7JPBT006V69R487APS2FRV7/03.AC8.md), [08.AC3](evidence/_story/01M7JPBT006V69R487APS2FRV7/08.AC3.md), [08.AC4](evidence/_story/01M7JPBT006V69R487APS2FRV7/08.AC4.md)).
- **JSON stays JSON**
  **After:** two-space indent, key order kept ([03.AC9](evidence/_story/01M7JPBT006V69R487APS2FRV7/03.AC9.md)).
- **Run state untouched**
  **After:** machine dir hash equal before and after, but that dir held no units; unverified with real units, check `upgrade-wording.test.ts` › "units with pins, receipts and state…" in CI ([08.AC5](evidence/_story/01M7JPBT006V69R487APS2FRV7/08.AC5.md)).
- **doctor → upgrade → doctor ends clean**
  **After:** 7 failing checks, then `norn upgrade`, then "norn doctor: every check passes" ([09.AC8](evidence/_story/01M7JPBT006V69R487APS2FRV7/09.AC8.md)).

**Shipped workflows, schemas and docs**

- **`norn init` writes the new wording; this repo's copies too**
  **After:** every shipped file and this repo's `.agents/workflows/` (with `release.yaml`) load in the new wording ([05.AC1](evidence/_story/01M7JPBT006V69R487APS2FRV7/05.AC1.md), [05.AC2](evidence/_story/01M7JPBT006V69R487APS2FRV7/05.AC2.md)).
- **Orientations tell the agent what the step is for**
  For a person: read the `agent:` lines in `packages/cli/assets/workflows/*.yaml`. Approved at human-qa#1 (ebc79fa); the workflow text has not moved since ([05.AC4](evidence/_story/01M7JPBT006V69R487APS2FRV7/05.AC4.md)).
- **Emitted JSON Schema describes the new wording only**
  **After:** schema emit check clean, old keys rejected ([05.AC3](evidence/_story/01M7JPBT006V69R487APS2FRV7/05.AC3.md)).
- **Docs and the generated reference show the new wording**
  **After:** concepts page, recipes and reference updated; docs emit check up to date ([10.AC1](evidence/_story/01M7JPBT006V69R487APS2FRV7/10.AC1.md), [10.AC2](evidence/_story/01M7JPBT006V69R487APS2FRV7/10.AC2.md)).
- **Tests migrated, asserting the same; transcripts move only in wording**
  **After:** unit tier green (check test#2) and e2e green locally (one light-path harness flake on `git clone`, then 5/5 twice) ([06.AC2](evidence/_story/01M7JPBT006V69R487APS2FRV7/06.AC2.md), [07.AC1](evidence/_story/01M7JPBT006V69R487APS2FRV7/07.AC1.md), [07.AC2](evidence/_story/01M7JPBT006V69R487APS2FRV7/07.AC2.md)).

Unverified until CI runs on this head: the cli integration suite ([06.AC1](evidence/_story/01M7JPBT006V69R487APS2FRV7/06.AC1.md)), which red-lit 3 of 4 shards at d01b9d7 and whose three stale tests were fixed since; it carries the checks for the read kinds' integration tests, no round from an old file, the old pin in flight, the lost-record restart and run state under upgrade. All four `integration` shards must be green before ready.

## Merge danger

**Door:** one-way: repos that run `norn upgrade` commit new-wording workflow files an older norn cannot read, and a revert does not rewrite them back.

**Blast radius:** every norn repo: on release, a main checkout still holding old-wording workflows starts no new round until `norn upgrade` runs; stories in flight carry on through the translated pins. The workflow hash moves for every shipped workflow, though decisions do not. `norn brief --json` renames `work.skill` (string) to `work.skills` (array), a breaking change for any script reading it.
