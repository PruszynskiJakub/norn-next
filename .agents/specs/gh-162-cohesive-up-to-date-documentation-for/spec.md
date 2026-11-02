---
id: gh-162
slug: cohesive-up-to-date-documentation-for
provider: gh
number: 162
url: https://github.com/PruszynskiJakub/norn-next/issues/162
title: Cohesive, up-to-date documentation for newcomers
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:refinement
workflow: refinement
status: active
intake_at: 2026-11-02T08:57:16.094Z
body_hash: a8eafb25c7047dd6d22d5ba7d362414674429b7a1a6c33750728419341d752f8
---

# Cohesive, up-to-date documentation for newcomers

## Problem

A person who hears about norn and wants to try it on their own repository opens the README and gets everything at once: the pitch, install, a quick start, concepts, config, plugins, architecture, every command and the contributing guide, in one 250-line page. From there the trail splits: a cookbook that only works when downloaded and opened in a browser, a limitations page that says "as of release 0.5.0" while the current release is 0.17.0, and a spec that is a 545-line PRD plus four separate `SPEC-*` files, some of whose rules are copied into the PRD and some not. Nothing says which doc to read first, several say the same thing in different words, and some of it is no longer true. A newcomer cannot tell what is current, and a contributor cannot tell which file holds a rule.

Contributors have the same problem from the other side: the person's loop is told in the README, `CONTRIBUTING.md` and `AGENTS.md`; three folders of old dogfood audits sit under `docs/`; a stray `handoff.md` from an earlier PR is tracked at the repo root; and nothing catches a doc that drifts from the CLI.

## Solution

The docs become a small set where each file has one reader and nothing is said twice:

- **README**: for someone trying norn. The pitch, who it is for, install, set up a repository, run a first story, then a map of links to everything else.
- **Concepts**: how norn works, for that same user, ending with the glossary.
- **Reference**: every command and flag and every config key, generated from the CLI itself, plus the shipped workflows and exit codes.
- **Recipes**: how-tos by situation (an agent that asks or dies, a base that moved, a custom workflow, handing a story over), as markdown.
- **Limitations**: what is still open or unproven, with no version stamp.
- **Herdr plugin README**: unchanged in place, linked from the README.
- **CONTRIBUTING**: the person's side of contributing; links to AGENTS for code commands, layout and rules.
- **AGENTS**: the agent's side; links to CONTRIBUTING instead of retelling the person's loop.
- **Rules**: the PRD is replaced by a rules-only file holding every id'd rule, with the four `SPEC-*` files folded in and every id unchanged. The product narrative goes.

The cookbook page, the audit folders and the stray root handoff are removed. Repo tests keep the set honest: the reference must match the CLI, every command and flag a doc names must exist, links and anchors must resolve, no doc carries a version except the release badge and the changelog, and no handoff is tracked outside a unit's runs.

Behaviour does not change.

## Behaviour

### Readers and the path through the docs

- B1 As a person trying norn, I want the README to take me from nothing to a finished first story, so that I see norn work before I learn its model.
  Example: a newcomer reads the README top to bottom: pitch, "is norn for you", install, set up a repository, run a first story, with the commands to type and what each one shows, and stops there, roughly 100 lines in.
- B2 As a person trying norn, I want the README to end in a map naming each other doc and who it is for, so that I know where to go next.
  Example: the map lists Concepts ("how norn works"), Reference ("every command, flag and config key"), Recipes ("what to do when…"), Limitations, the Herdr plugin and Contributing, each with one line and a link.
- B3 As a contributor, I want the README's contributing part to be a pointer, so that the person's loop is told in one place.
  Example: the README's Contributing section is two lines linking to CONTRIBUTING.md; the loop, labels and setup are not in the README.
- B4 As a reader of any doc, I want each topic explained in exactly one doc, with the others linking to it, so that two docs cannot disagree.
  Example: the config layers are explained in Reference; the README's "make it yours" says one sentence and links to the Reference section instead of repeating the layer order.

### Concepts and glossary

- B5 As a person trying norn, I want a Concepts doc that explains story, slice, unit, workflow, step, gate, check, inbox, modes and one tick, so that I understand what I saw in my first story.
  Example: after a first story, a reader opens Concepts and learns why the inbox showed an Approve item: a gate in the workflow waits for a person.
- B6 As any reader, I want the glossary to live in Concepts, as a definitions table at its end, so that I can look up a term without opening the rules.
  Example: a reader looking up "gate" finds its definition in the table at the end of Concepts; the rules file's glossary section is a link there plus the banned-synonyms rule and the identifier rules.
- B7 As a contributor, I want the glossary lint to cover the new docs, so that banned synonyms stay out of them.
  Example: writing "pick the next job" in Concepts or Recipes fails the repo test with the replacement "story / slice", as it does today in the README.

### Reference

- B8 As a person using norn, I want a Reference doc listing every command with its flags, so that I can look up any command without running help.
  Example: Reference lists `norn story approve`, `norn run view --why`, `norn status --watch` with their flags, in the same noun tree `norn help` shows.
- B9 As a person using norn, I want Reference to list every config key, so that I can configure norn from the docs.
  Example: Reference names each key of the repo config with its type and default, matching the config schema, and says which layers override which.
- B10 As a contributor, I want the commands-and-flags and config parts of Reference generated from the CLI's own definitions, with a regenerate command, so that adding a command updates the docs in the same PR.
  Example: a story adds a flag to `norn story edit`; running the regenerate command rewrites the generated block of Reference, and the diff shows the new flag.
- B11 As a contributor, I want a repo test that fails when the generated part of Reference is stale, so that a forgotten regenerate is caught in CI.
  Example: a flag is added without regenerating; the unit tier fails, naming Reference and the regenerate command to run.
- B12 As a contributor, I want hand-written prose in Reference kept outside the generated block, so that regenerating never overwrites it.
  Example: the paragraph explaining exit codes survives a regenerate unchanged.
- B13 As a person using norn, I want Reference to list the workflows `norn init` ships and the exit codes, so that I know what I start from.
  Example: Reference names `triage`, `reproduce`, `refinement`, `story`, `slice`, `quick`, one line each, and the exit codes including `refused` = 3.

### Recipes

- B14 As a person using norn, I want the cookbook's recipes as a markdown Recipes doc, so that they read on GitHub without downloading anything.
  Example: a reader opens Recipes on GitHub and finds "an agent asked a question", "an agent died", "the base moved", "write a custom workflow", "hand a story over", each as a short how-to.
- B15 As any reader, I want the cookbook page removed, with its "why", map and reference parts not carried over, so that they are not a second copy of the README, Concepts and Reference.
  Example: the README no longer links to a cookbook page; the repository has no cookbook HTML.

### Limitations

- B16 As a person deciding whether to use norn, I want a Limitations doc that lists only what is still open or unproven and the limits of the design, so that what I read is true today.
  Example: Limitations has "Gaps still open", "Not yet proven in real use" and "Limits of the design"; it has no "Fixed since…" list and no "as of release" line.
- B17 As a person deciding whether to use norn, I want each listed limitation checked against the current release, so that nothing fixed is still listed.
  Example: a gap fixed in an earlier release is not in Limitations; it is in the changelog.
- B18 As a person using norn, I want the deferred items a user meets (for example, no redaction of secrets in committed logs) in Limitations, so that I learn them before they bite.
  Example: Limitations says check output is committed unredacted, so keep secrets out of it.
- B19 As any reader, I want Limitations to sit with the other user docs, linked from the README map, so that it is found.
  Example: the README map links Limitations; nothing else links the old location.

### Contributing and agents

- B20 As a person contributing to norn, I want CONTRIBUTING.md to hold everything a person does (the loop, workflows chosen by label, collaborator setup, person-only skills, releases, the bypass, GitHub settings), so that I need only one doc for my side.
  Example: a new collaborator sets up a machine and starts a story using only CONTRIBUTING.md and the links in it.
- B21 As a person contributing to norn, I want CONTRIBUTING.md to link to AGENTS.md for dev commands, layout and code rules instead of repeating them, so that they are said once.
  Example: CONTRIBUTING.md says "to run the tests and find your way in the code, read AGENTS.md" and lists no `bun` commands itself.
- B22 As an agent working in the repo, I want AGENTS.md to hold what I must follow (commands, test tiers, layout, decisions, process from the agent's side, contracts, rules) and to link to CONTRIBUTING.md for the person's side, so that I read no person-facing text.
  Example: AGENTS.md's Process names the hard rule and the agent's side and links to CONTRIBUTING.md for the person's loop.

### Rules (replacing the PRD)

- B23 As a contributor or agent, I want one rules file that holds every id'd rule, with no product narrative, so that I know where a rule lives.
  Example: looking up S5, P8, R5.1, HC6 or CP2 finds each in the rules file; there is no PRD file and no `SPEC-*` file.
- B24 As a contributor or agent, I want every rule id unchanged, so that the existing citations in code, tests and golden cases still resolve.
  Example: a code comment citing R5.1 or HC13 names a rule present in the rules file, worded as before or as its amended form.
- B25 As a contributor or agent, I want the rules of the four former `SPEC-*` files placed in the section of the rules file they belong to, so that related rules sit together.
  Example: the R rules on claims and recovery sit with the claim and heartbeat rules; HC, CP, OR and SG sit in a cockpit and Herdr subsection of the human-interface section.
- B26 As a contributor or agent, I want a rule that a former spec amended to say what is true now, so that I never have to combine two rules in my head.
  Example: MO4 says attended steps show as Your turn after the attended wait; it no longer points to another file for that part.
- B27 As a contributor or agent, I want rules that were copied in two places (BS, QV, NT) to appear once, with none lost, so that there is one version of each.
  Example: every BS id that the base-sync spec defined appears exactly once in the rules file, including the ones the PRD did not copy.
- B28 As a contributor or agent, I want the former specs' narrative (why, goals, contract changes, acceptance, status lines) gone, so that the rules file holds rules only.
  Example: the rules file has no "Why" or "Acceptance" section from a former spec.
- B29 As a contributor or agent, I want the PRD's non-rule sections handled: summary, problem and goals feed the README pitch; architecture and packaging, milestones, success criteria, risks and prior art are dropped; principles and identifiers stay as rules, so that only rules remain.
  Example: P1–P8 and the identifier rules are in the rules file; milestones and prior art are nowhere in the docs.
- B30 As a contributor or agent, I want the rules file to open with how to cite an id and how a story amends a rule, so that the process rule moves with the file.
  Example: the intro says "cite ids in code comments where a rule is enforced; a rule change goes through `refinement` or `quick` and amends this file directly; never add another rules file".
- B31 As a contributor or agent, I want every pointer to the PRD or a former spec updated to the rules file (AGENTS.md, this repo's workflow instructions and skills, source comments, repo tests), so that no link or instruction points at a removed file.
  Example: the refinement workflow's instruction says a rule change amends the rules file; the issue skill's "PRD" section is renamed to match; searching the repository for the old file names finds nothing outside the changelog and git history.

### Removed files

- B32 As a contributor, I want the three dogfood audit folders removed, so that the docs folder holds only current docs.
  Example: the docs folder holds Concepts, Reference, Recipes, Limitations and the logo asset; git history still has the audits.
- B33 As a contributor, I want the stray root handoff removed, so that the repo root holds only project files.
  Example: the repo root has no handoff file.

### Keeping the docs current

- B34 As a contributor, I want a repo test that fails when a handoff file is tracked outside a unit's runs folder, so that the next accidental commit is caught.
  Example: a squash that adds a handoff at the repo root fails the unit tier, naming the file.
- B35 As a contributor, I want a repo test that every `norn …` command and flag named in the README, Concepts, Recipes and CONTRIBUTING exists in the CLI, so that a doc cannot teach a command that is gone or never was.
  Example: Recipes says `norn story approve gh-1 --force`, and `--force` is not a flag of `story approve`; the unit tier fails, naming the file, line and flag.
- B36 As a contributor, I want a repo test that every relative link in tracked markdown points to a file that exists, and every `#anchor` to a heading in it, checked offline, so that moving or renaming a doc cannot leave dead links.
  Example: the README links Reference's config section by an anchor; renaming that heading fails the unit tier, naming the README line and the missing anchor.
- B37 As a contributor, I want external URLs left unchecked by that test, so that the unit tier stays offline and deterministic.
  Example: a link to a GitHub page is skipped.
- B38 As a contributor, I want a repo test that no doc names a norn version except the README release badge and the changelog, so that nothing drifts into another "as of 0.5.0".
  Example: Limitations says "as of 0.17.0"; the unit tier fails, naming the line.
- B39 As a person trying norn, I want the few output examples (the README's first-story walkthrough, at most one per recipe) taken from a real run of the current release, so that what I see matches what the docs show.
  Example: the README shows the `norn status` inbox after `norn init` exactly as the current release prints it, apart from names and ids; QA reruns each example and compares.
- B40 As a contributor, I want every command, flag and output example in the docs checked against the current CLI in this story, with any disagreement fixed in the doc, so that the set starts out true.
  Example: the README's quick start names a flag that was renamed; the doc is corrected, and the CLI is not changed.

## Out of scope

- Any behaviour change: where a doc and the CLI disagree the doc is fixed, and a CLI bug found along the way becomes its own issue.
- The text norn ships (`norn help`, the bundled skills and workflows) beyond a pointer to a doc this story moves or removes: it is product, not docs.
- Checking external URLs: it needs the network and is not deterministic.
- A docs website or site generator beyond the generated Reference block: markdown on GitHub is enough for now.
- An editorial rewrite of the rules themselves beyond the fold and the amended-rule rewrites: a rule change is a behaviour discussion of its own.
- Testing output examples automatically: few examples, kept honest by QA and review.
- `CHANGELOG.md`: the release step writes it.

## Open questions

## Plan
