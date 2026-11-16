## Summary

Workflow authors now write each step with one head key that says what happens. An agent step's skills become an optional list. Meanings and verdicts move out of the routes into sibling maps, and `by:` picks the agent. Old-wording files in the main checkout are refused and `norn upgrade` rewrites them without losing anything. Old pins and story-branch files still load through the same translation, and decide makes the same decisions.

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
load workflow text
  main checkout .agents/workflows/ ─ old wording? → refuse, do_instead: norn upgrade
  pin / story-branch file ─ old wording? → translate (the same code as norn upgrade) → load
```

## Evidence

QA #1 ran on the whole story: 47 criteria pass, 0 fail, 1 is for a person to judge and 5 are unverified (listed below). Full table: [report.md](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/report.md).

**Writing a step**

- **Agent step headed `agent: <orientation>`, other keys beside it**
  **Before:** `type: agent` + `skill:` + `instructions:`. **After:** the step loads with every sibling key ([04.AC1](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/04.AC1.md)).
- **Check step headed `check: <command>`**
  **Before:** `type: check` + `run:`. **After:** loads with `timeout`, `exits` and `outcomes` ([04.AC1](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/04.AC1.md), [05.AC1](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/05.AC1.md)).
- **Gate headed `gate: <what the person decides>`**
  **Before:** `type: gate` + `prompt:`. **After:** shipped gates load in this form ([05.AC1](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/05.AC1.md)).
- **Built-in steps as value-less verbs**
  **Before:** `type`/`action` pairs. **After:** each of the six verbs loads to the same kind with the same outcomes ([04.AC2](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/04.AC2.md)).
- **`use:` unchanged**
  **After:** shared steps load as written, and their `{ exit: … }` routes still route ([04.AC11](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/04.AC11.md)).
- **Two head keys or none refused, naming the step**
  **Before:** did not exist. **After:** refused at load ([04.AC3](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/04.AC3.md)).
- **A verb with a value refused**
  **After:** `open-pr: now` is refused at load ([04.AC2](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/04.AC2.md)).
- **`like` inherits the head key; a different one is refused**
  **After:** both cases observed ([04.AC4](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/04.AC4.md)).

**Agent steps: orientation and skills**

- **Missing or empty orientation refused**
  **After:** refused, naming the step ([04.AC5](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/04.AC5.md)).
- **`skills:` optional**
  **Before:** exactly one skill was required. **After:** a step without `skills:` loads ([04.AC6](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/04.AC6.md)).
- **`unknown_skill` for each listed skill**
  **After:** the same refusal as before, once for each missing or invisible skill ([02.AC4](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/02.AC4.md)).
- **A skill named twice refused**
  **After:** refused at load ([04.AC6](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/04.AC6.md)).
- **Brief: one, several or no skills**
  **Before:** the brief always said "Use the `X` skill.". **After:** "Use the `norn-implement` skill.", "… `norn-implement` and `norn-tdd` skills.", "…, `norn-tdd` and `norn-codebase-design` skills.", and with no skills only the orientation ([02.AC1-3](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/02.AC1-3.md), [output](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/02.AC1-3-brief-output.txt)). These are three user stories.
- **`by:` picks the configured agent, falling back to the default**
  **Before:** a per-step `agent: <name>`. **After:** both the named agent and the fallback observed ([04.AC7](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/04.AC7.md)).

**Outcomes, meanings and verdicts**

- **`outcomes:` as a plain map; `means:` / `verdict:` beside it**
  **After:** `outcome: target` and `{ to, counter }` load with the sibling maps ([04.AC8](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/04.AC8.md)).
- **Brief finish lines unchanged**
  **After:** each outcome's meaning and verdict render as before ([04.AC8](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/04.AC8.md), [04.AC12](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/04.AC12.md)).
- **A routed reportable outcome with no meaning refused; overridable routes exempt**
  **After:** refused, naming the step and outcome. `silent`/`died`/`timeout`/`stalled`/`ask`/`stuck` need no meaning ([04.AC9](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/04.AC9.md)).
- **Stale or misplaced `means`/`verdict` refused**
  **After:** refused for an unrouted outcome, on a non-agent step, and inside an edge ([04.AC10](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/04.AC10.md)).
- **Shared `{ exit: … }` routes keep working**
  **After:** they load and route ([04.AC11](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/04.AC11.md)).

**The old wording**

- **Main-checkout old wording refused, `do_instead` names `norn upgrade`; mixed steps too**
  **Before:** loaded. **After:** e.g. ``written in the old wording: step 'a' (action); run `norn upgrade` to rewrite it and commit``, exit 3 ([09.AC1](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/09.AC1.md), [09.AC2](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/09.AC2.md)).
- **doctor: one issue per file; treated like an invalid workflow**
  **After:** two old files give two FAIL lines, each naming `norn upgrade`, and no new round starts from them ([09.AC3](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/09.AC3.md), [09.AC4](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/09.AC4.md)).
- **Story in flight on an old pin keeps running; past records stay readable**
  **After:** in a harness repo, an old-wording pin ran to `$done` with its bytes and hash untouched and its record readable. A past round's trace was not replayed, so this is unverified ([09.AC5](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/09.AC5.md)).
- **Restart from an old-wording branch file**
  **After:** the shipped integration test passes (pin verbatim, hash equal). No restart was driven by hand, so this is unverified ([09.AC6](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/09.AC6.md)).
- **New units pin the new wording**
  **After:** observed ([09.AC7](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/09.AC7.md)).
- **Same decisions in either wording**
  **After:** all 139 golden cases' `decisions` are byte-identical to origin/main, and each shipped file loads equal in both wordings ([02.AC6](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/02.AC6.md), [04.AC12](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/04.AC12.md)).

**norn upgrade**

- **Rewrites and stages old files in workflows/ and shared/**
  **After:** 12 files rewritten and staged with the config, exit 0 ([08.AC1](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/08.AC1.md)).
- **Rewrite loads to the same workflow**
  **After:** before and after loads are equal ([08.AC1](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/08.AC1.md), [04.AC12](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/04.AC12.md)).
- **Comments, key order and scalar styles kept; edge comments stay on the outcome's line**
  **After:** the 9 shipped files and release.yaml translate byte for byte to the expected files ([03.AC1](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/03.AC1.md), [03.AC2](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/03.AC2.md), [03.AC5](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/03.AC5.md)).
- **An unplaceable comment refuses only that file**
  **After:** the file and the comment's line are named, the other files are rewritten, exit 0 ([03.AC7](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/03.AC7.md), [08.AC2](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/08.AC2.md)).
- **`skill:` → `skills: [X]`, instructions become the orientation word for word**
  **After:** observed ([03.AC3](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/03.AC3.md)).
- **Fallbacks: no instructions → description or "Use the `X` skill."; no gate prompt → description or `approve or reject <step>`**
  **After:** observed ([03.AC4](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/03.AC4.md)). These are two user stories.
- **`agent: <name>` → `by: <name>`**
  **After:** observed ([03.AC6](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/03.AC6.md)).
- **A second run changes nothing**
  **After:** idempotent ([03.AC8](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/03.AC8.md), [08.AC3](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/08.AC3.md)).
- **JSON stays JSON**
  **After:** output is JSON with a two-space indent and the key order kept ([03.AC9](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/03.AC9.md)).
- **Machine dir untouched**
  **After:** the machine dir's hash is equal before and after ([08.AC5](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/08.AC5.md)).
- **Files already in the new wording: no workflow change**
  **After:** nothing rewritten or reported ([08.AC4](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/08.AC4.md)).
- **doctor → upgrade → doctor ends clean**
  **After:** "norn doctor: every check passes" ([09.AC8](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/09.AC8.md)).

**Shipped workflows and docs**

- **`norn init` writes the new wording with hand-written orientations**
  **After:** every shipped file loads in the new wording ([05.AC1](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/05.AC1.md)). Whether each orientation steers well is for a person to judge, using the table in [05.AC4](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/05.AC4.md). The fsd gate approved it, so please confirm it on this head.
- **This repo's copies, `release.yaml` included, in the new wording**
  **After:** all load ([05.AC2](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/05.AC2.md)).
- **Emitted JSON Schema describes the new wording only**
  **After:** the schema emit check is clean and old keys are rejected ([05.AC3](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/05.AC3.md)).
- **Docs and the generated reference show the new wording**
  **After:** the concepts page, recipes and reference are updated, and the docs emit check is up to date ([10.AC1](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/10.AC1.md), [10.AC2](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/10.AC2.md)).

Unverified until CI runs on this PR: the cli integration tier (including the restart and record read tests) and the e2e tier must be green on the final head. The unit tier passed in test#1 ([06.AC1-07.AC1](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/06.AC1-07.AC1.md)). The migrated tests assert the same behaviour, and the transcripts and snapshots moved only in fixture wording ([06.AC2](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/06.AC2.md), [07.AC2](evidence/_story/01M7JMBBE3469ZP7AM4GP7466T/07.AC2.md)).

## Merge danger

**Door:** one-way. Repos that run `norn upgrade` commit new-wording workflow files, and an older norn cannot read them. Reverting the code does not rewrite those files back.

**Blast radius:** every norn repo. On release, any main checkout still holding old-wording workflows refuses to start new rounds until `norn upgrade` runs. Stories in flight continue because old pins and branch files are translated. The workflow hash moves for every shipped workflow, but decisions do not (the golden cases are byte-identical).
