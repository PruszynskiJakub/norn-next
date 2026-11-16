---
id: gh-343
slug: a-step-is-written-with-two-keys-for-one
provider: gh
number: 343
url: https://github.com/PruszynskiJakub/norn-next/issues/343
title: A step is written with two keys for one fact, and an agent step must name a skill
assignee: PruszynskiJakub
labels:
  - norn
  - norn:kind:feature
  - norn:priority:medium
  - norn:risk:high
  - norn:wf:refinement
workflow: refinement
status: active
intake_at: 2026-11-16T15:23:54.534Z
body_hash: 7fbc55d648d29da4c82b1f01627eee670941563520c70a99287cf49a8e7474ca
---

# A step is written with two keys for one fact, and an agent step must name a skill

## Problem Statement

Whoever writes or reads a workflow, a person or an agent, meets each step saying what it is twice: `type: agent` plus `skill:`, `type: check` plus `run:`, `type: git` plus `action:`, `type: gate` plus `prompt:`. An agent step must name exactly one skill, even when a paragraph of instructions does the real steering (`triage`, `reproduce`), and the brief always tells the agent to use that skill. An agent's routes are nearly all written in the long form `{ to, counter, means, verdict }`, so where a step leads and what each outcome means to the agent share one line, and the path through a workflow is hard to read. Every later change to the workflow format (a workflow skill, derived counters) would build on this wording.

## Solution

A step opens with exactly one key that says what happens: `agent: <orientation>`, `check: <command>`, `gate: <what the person decides>`, or a built-in verb with no value (`update-branch:`, `open-pr:`, `integrate:`, `push:`, `await-merge:`, `slices:`); `use:` is unchanged. An agent step's orientation is required; the skills it uses are an optional `skills:` list. `outcomes:` holds only `outcome: target` (or `{ to, counter }`); an agent step's meanings and verdicts sit beside it in `means:` and `verdict:` maps. The key that picks which configured agent runs a step becomes `by:`.

The files in the main checkout's `.agents/workflows/` are accepted only in the new wording; `norn upgrade` rewrites them mechanically, keeping their comments and layout. Stories already in flight keep running: a pinned workflow, or a workflow file read from a story branch, in the old wording still loads. decide makes the same decisions as before.

| Today | New |
|---|---|
| `type: agent` + `instructions:` | `agent: <orientation>` |
| `skill: X` | `skills: [X]` (optional) |
| per-step `agent: <name>` | `by: <name>` |
| `type: check` + `run:` | `check: <command>` |
| `type: gate` + `prompt:` | `gate: <what the person decides>` |
| `type: git`, `action: update` | `update-branch:` |
| `type: git`, `action: open-pr` | `open-pr:` |
| `type: git`, `action: integrate` | `integrate:` |
| `type: git`, `action: push` | `push:` |
| `type: merge` | `await-merge:` |
| `type: slices` | `slices:` |
| `done: { to: X, means: "…", verdict: pass }` | `done: X` in `outcomes:`, `done: …` in `means:`, `done: pass` in `verdict:` |

## User Stories

### Writing a step

1. As a workflow author, I want an agent step written as `agent: <orientation>` with its other keys (`skills`, `inputs`, `outcomes`, `means`, `verdict`, `by`, `model`, `attended`, `deadline`, `nudges`, `retries`, `criteria`, `description`) beside it, so that the step says what happens in its first line.
2. As a workflow author, I want a check step written as `check: <command>` with `timeout`, `exits` and `outcomes` beside it, so that the command is the step's head.
3. As a workflow author, I want a gate written as `gate: <what the person decides>`, so that the decision the inbox shows is the step's head.
4. As a workflow author, I want the built-in steps written as one verb with no value (`update-branch:`, `open-pr:`, `integrate:`, `push:`, `await-merge:`, `slices:`), each taking the same outcomes as its kind does today, so that I need not know the `type`/`action` pairs.
5. As a workflow author, I want a `use:` step to stay exactly as it is written today, so that shared steps need no change.
6. As a workflow author who writes a step with two head keys (for example `agent:` and `check:`), or with none, I want norn to refuse the file at load and name the step, so that a step never means two things.
7. As a workflow author, I want a verb step that is given a value (for example `open-pr: now`) refused at load, so that a verb carries no hidden meaning.
8. As a workflow author, I want a `like` step to inherit its target's head key, and a copy that writes a different head key refused for having two head keys, so that a copy cannot quietly change what kind of step it is.

### Agent steps: orientation and skills

9. As a workflow author, I want an agent step whose orientation is missing or empty refused at load, so that every agent is told what the step is for.
10. As a workflow author, I want `skills:` optional on an agent step, so that a step steered by its orientation alone (like `triage` or `reproduce`) needs no token skill.
11. As a workflow author who names a skill that is not installed (or not visible to the agent that runs the step), I want the same `unknown_skill` refusal at load as today, for each skill in the list, so that a typo is caught before a unit starts.
12. As a workflow author who names the same skill twice in `skills:`, I want the file refused at load, so that the list stays a set.
13. As an agent doing a step with one skill, I want the brief to say "Use the `X` skill." under Your work, followed by the orientation, so that I know which craft to load and what the step is for.
14. As an agent doing a step with several skills, I want the brief to say "Use the `X` and `Y` skills." (commas for three or more) in the order the list gives them, followed by the orientation.
15. As an agent doing a step with no skills, I want the brief to name no skill and give only the orientation, so that I am never sent to a skill that does not apply.
16. As a workflow author, I want the key that picks which configured agent runs a step named `by:` (`by: codex`), taking a name from the config's agents and falling back to the config's default agent, so that it no longer clashes with `agent:` the orientation.

### Outcomes, meanings and verdicts

17. As a workflow author, I want `outcomes:` to hold `outcome: target`, or `{ to, counter }` when the route counts against a counter, so that the routes read as a plain map.
18. As a workflow author, I want an agent step's meanings in a sibling `means:` map and its verdicts in a sibling `verdict:` map, keyed by outcome, so that routing and prose are apart.
19. As an agent finishing a step, I want the brief's finish lines to show each outcome's meaning and verdict exactly as they read today, so that the move of the prose changes nothing I see.
20. As a workflow author, I want norn to refuse at load a reportable agent outcome that has a route and no meaning, naming the step and outcome, so that every outcome an agent may report has a contract.
21. As a workflow author, I want norn to refuse at load a meaning or a verdict for an outcome the step does not route, so that no stale prose is left behind.
22. As a workflow author, I want the overridable routes (`silent`, `died`, `timeout`, `stalled`, `ask`, `stuck`) to need no meaning, so that overriding where they lead stays one line.
23. As a workflow author, I want `means:` and `verdict:` refused on any step that is not an agent step, and `means`/`verdict` inside an edge refused everywhere, so that there is one place for each.
24. As a workflow author of a shared file, I want its `{ exit: … }` routes to keep working as written today, so that shared steps leave the same way.

### The old wording

25. As a person whose main checkout's `.agents/workflows/` holds a file in the old wording (any `type:` key, `skill:`, `instructions:`, `run:`, `prompt:`, `action:`, or `means`/`verdict` inside an edge), I want norn to refuse it with a message naming the old wording and a `do_instead` naming `norn upgrade`, so that I know the one command that fixes it.
26. As a person whose file mixes old and new wording in one step, I want it refused as old wording with the same `do_instead`, so that a half-edited file is not guessed at.
27. As a person running `norn doctor` on a repo with old-wording workflow files, I want one issue per such file naming `norn upgrade`, so that I see every file affected at once.
28. As a person whose main checkout's workflow files are refused, I want norn to treat them as it treats an invalid workflow today (no new round starts from them; doctor, sync and the inbox report them), so that nothing runs on a file norn cannot read.
29. As a person with a story in flight when the new norn arrives, I want its pinned workflow in the old wording to keep loading, with its text and hash on disk untouched, so that the story finishes its round without any action from me.
30. As a person reading the record or trace of a past round, I want its old-wording pin to load as before, so that history stays readable.
31. As a person restarting a story whose record is lost (`norn story checkout`), I want a workflow file read from its story branch in the old wording to load, as a pin does, so that a branch cut before the upgrade can still be restarted.
32. As a person, I want units started after the upgrade to pin their workflow in the new wording, so that new run state never holds the old one.
33. As a person, I want decide to make exactly the same decisions on a workflow whether it was written in the old or the new wording, so that the change is in the writing only.

### norn upgrade

34. As a person running `norn upgrade`, I want each file in the main checkout's `.agents/workflows/` and its shared folder in the old wording rewritten to the new wording and staged with the rest of the upgrade, so that one command and one commit move the repo over.
35. As a person, I want the rewrite to load to the same workflow as before, so that what runs does not change.
36. As a person, I want the rewrite to keep every comment, the key order, the scalar styles (block, folded, quoted) and every untouched key in place, so that my file still reads as I wrote it.
37. As a person, I want a comment on a long edge that is split into `outcomes:` / `means:` / `verdict:` kept on that outcome's line in `outcomes:`, so that it stays next to the route it explained.
38. As a person whose file holds a comment the rewrite cannot place, I want upgrade to refuse that one file, naming the file and the comment's line, and still rewrite every other file, so that I have one hand edit left and not a stuck repo.
39. As a person, I want `skill: X` rewritten as `skills: [X]`, and an agent step's `instructions` to become its orientation word for word, so that the brief says what it said before.
40. As a person whose agent step has a skill and no instructions, I want upgrade to write the step's `description` as the orientation, or, with no description, the line ``Use the `X` skill.``, so that the rewrite stays mechanical and the step loads.
41. As a person whose gate has no prompt, I want upgrade to write the gate's `description` as its text, or, with no description, "Approve to go on, or reject with what to change.", so that the gate loads.
42. As a person whose agent step sets `agent: <name>` to pick its agent, I want upgrade to rename it to `by: <name>`, so that the step keeps running on the same agent.
43. As a person running `norn upgrade` a second time, I want it to change no workflow file, so that it is safe to repeat.
44. As a person with a workflow written in JSON, I want the rewrite to keep it JSON, so that my tooling still reads it.
45. As a person, I want `norn upgrade` never to touch anything under the machine dir's run state, so that pins, receipts and their hashes stay immutable.
46. As a person whose files are all in the new wording already, I want `norn upgrade` to rewrite none of them and report no workflow change.

### Shipped workflows and docs

47. As a person running `norn init`, I want the shipped workflows and shared files written in the new wording, each agent step with a hand-written orientation (as in the design record's `quick.yaml`), so that a new repo starts in the current wording.
48. As a contributor to this repo, I want this repo's workflow copies, including `release.yaml` (which has no shipped copy), written in the new wording with hand-written orientations, so that norn runs on its own wording.
49. As a workflow author, I want the emitted JSON Schema to describe the new wording only, so that my editor completes and checks the keys I write.
50. As a reader of the docs, I want the concepts page, the recipes (including writing your own workflow and naming your own skill in a step), and the generated reference to show the new wording, so that nothing teaches the old one.

## Out of Scope

- Counters and derived bounds — a separate issue.
- Shared steps — already shipped; `use:` is unchanged here.
- Gates' new keys (what a gate judges, whether it may be delegated) — a separate issue; only the gate's text moves here.
- Hand-backs (files a step must hand back) — a separate issue.
- Simplifying the base update's light path — a workflow edit of its own, recorded in the design record.
- Rewriting pins or any other run state — run state is immutable; old pins load through the translation instead.

## Further Notes

- Design record: https://gist.github.com/PruszynskiJakub/0dcf9042145fe9c46f32bd9b8b94fb19 (`quick.yaml` shows the wording). Related: #341 (a workflow skill), #342 (shared steps).
- The name `by:` is a decision the owner may still rename before the build. `runner:` was rejected: in norn a runner is already the terminal runner (Herdr or headless), and an old `runner` config key is still refused.
- The value decide reads changes in one place only: an agent step's single skill becomes a list, and the check that tells a re-refined story reads "the step's skills include the refine skill". The golden cases' embedded workflows are rewritten to the new shape; their decisions do not change.
- The old-wording refusal applies only to the main checkout's `.agents/workflows/` (what doctor, sync, a new round and upgrade read). Pins and files read from a story branch are copies from before the upgrade and load through the same translation `norn upgrade` uses.
- Changing how norn reads workflows is a new minor, which by the repo's version rule needs `norn upgrade` and a commit.
