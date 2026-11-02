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
  - norn:wf:quick
workflow: quick
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

Built in one branch (the `quick` workflow, no slices). Behaviour does not change, so the tests are all repo tests over the docs and one generator; the rest is written content, checked by review and QA.

### Seams

- **S1 The docs lint, through pure matchers over a line or a file's text, run over the doc set.** A new repo test module beside the existing glossary and removed-command lints, in the unit tier (reads files, starts no process). Each check is a pure function (text in, hits out) tested on strings first, then run over the real doc set and expected to return no hits, each hit naming file, line and what to fix. Observes B7, B23, B24, B27, B31, B34–B38.
  Prior art: the glossary lint (`glossaryHits`: matcher cases, then a sweep over the files) and the removed-command lint (`oldCommandHits`, with an allowlist of file + line + why) in the repo tests.
- **S2 The Reference generator, through one pure render function: the cli's command registry and the built-in config in, the generated block's markdown out.** A regenerate script writes it into Reference between markers, and a unit test compares the block in the file with a fresh render. Observes B8–B13.
  Prior art: the published JSON schemas (`schema:emit` and the "json/… is up to date" test that compares the file with `renderSchema`).
- **S3 The written docs, through a person or agent reading them and running the commands they show.** Nothing automated can observe "the README gets me to a first story". These items are checked in review against the spec and in QA by following the docs in a throwaway repo with the released `norn`. Observes B1–B6, B14–B22, B25, B26, B28–B30, B32, B33, B39, B40.
  Prior art: none (no doc has been QA'd this way before).

### Coverage
| Behaviour | Seam | Test kind | Notes |
|---|---|---|---|
| B1 | S3 | QA (agent) | follow the README from nothing to a first story in a throwaway repo |
| B2 | S3 | review | the README map names each doc once; its links are checked by B36 |
| B3 | S3 | review | |
| B4 | S3 | review | check for topics told twice across the doc set |
| B5 | S3 | review | |
| B6 | S3 | review | the rules file's §5 is a link plus banned synonyms and §5.1 identifiers |
| B7 | S1 | unit | the glossary lint's file list takes every doc under the docs folder and the rules file |
| B8 | S2 | unit | every command and verb of the registry appears in the render |
| B9 | S2 | unit | every key of the built-in config appears with type and default |
| B10 | S2 | unit | the regenerate command writes the block; the render is tested, not the script |
| B11 | S2 | unit | the stale test fails naming the regenerate command |
| B12 | S2 | unit | the render replaces only the text between markers (tested on a string with prose around them) |
| B13 | S2 | unit | the shipped workflows are read from the cli's assets; exit codes from the schema's ExitCode |
| B14 | S3 | review | |
| B15 | S3 | review | the file's absence is also covered by B36 (the README link to it would be dead) |
| B16 | S3 | review | the "as of" line is also covered by B38 |
| B17 | S3 | QA (agent) | each listed gap is checked against the current code |
| B18 | S3 | review | |
| B19 | S3 | review | the old location's absence is covered by B31 |
| B20 | S3 | review | |
| B21 | S3 | review | |
| B22 | S3 | review | |
| B23 | S1 | unit | no PRD or `SPEC-*` file exists; the rules file does |
| B24 | S1 | unit | every rule id the old PRD and SPEC files defined (a list pinned in the test, taken once from them before they are deleted) is defined in the rules file |
| B25 | S3 | review | |
| B26 | S3 | review | |
| B27 | S1 | unit | each rule id is defined exactly once in the rules file |
| B28 | S3 | review | |
| B29 | S3 | review | |
| B30 | S3 | review | |
| B31 | S1 | unit | no tracked file names the PRD file or a `SPEC-*` file, except CHANGELOG and story specs |
| B32 | S3 | review | the folders' absence is visible in the diff |
| B33 | S3 | review | the file's absence; B34 then keeps it away |
| B34 | S1 | unit | |
| B35 | S1 | unit | |
| B36 | S1 | unit | |
| B37 | S1 | unit | matcher case: an https link is skipped |
| B38 | S1 | unit | |
| B39 | S3 | QA (agent) | each output example rerun with the released `norn` and compared, names and ids aside |
| B40 | S3 | QA (agent) | B35 covers commands and flags automatically; output examples by B39 |

### Prefactoring

1. Move the doc-text helpers of the repo tests (code-span and URL stripping, the walk over doc files) into a small shared test-support module, and make the lists of doc files come from one place. This changes no test outcome. It lets the new docs lint (S1) and the existing glossary and removed-command lints share one doc set, so adding a doc under the docs folder brings it under every check at once (B7, B35–B38).

### Implementation decisions

- D1 **The rules file keeps the PRD's section numbers.** Code cites sections (§9.3, §10, §7…) about 120 times. Kept sections keep their number; dropped ones (§17–§19, §21, §22) leave a gap rather than renumbering. The handful of citations to a dropped section (§17, §19, §20, §21, about a dozen) are rewritten to cite the rule or the doc that now holds the point. The alternative, renumbering, would rewrite every § citation for no reader's benefit.
- D2 **Where the former SPEC rules land.** R1–R10 go to §8 (heartbeat), §9 (agent integration), §12 (remote and git) and §13 (claims), each sub-rule (R5.1…) in the section it governs. HC, CP, OR and SG go to a new §15.1 "Cockpit and Herdr". BS, QV and NT stay in §12.1 and §10.1, with the base-sync rules the PRD did not copy (15 in the spec vs 11 in the PRD) added there. Every "(SPEC-x …)" pointer becomes the plain id.
- D3 **Reference generation is a root script, `bun run docs:emit`, next to `schema:emit`.** The render takes the command registry (every command and noun verb: usage, summary with spec ids stripped as `norn help` does, and the option help lines) in `norn help --all` order, the hidden ones under a "run by norn, not by hand" heading. It takes the config keys from the built-in config's explain output (key, type, default), and the shipped workflow names from the cli's assets. Hand-written prose sits outside two marker comments that say the block is generated and name the command. The stale test lives in the unit tier next to the other repo tests. Config keys get no generated descriptions (the config schema has none); the prose sections explain the keys a newcomer touches.
- D4 **Command-mention check (B35).** It scans inline code spans and fenced code blocks of the README, every doc under the docs folder except Reference's generated block, CONTRIBUTING and the Herdr plugin README. A mention is `norn` followed by words: the longest prefix that names a command or a noun verb must exist, and every `--flag` after it on that span or line must be one of that command's options, `--json` or `--help`. Placeholders (`<unit>`, `…`) are ignored. Prose outside code is not scanned, so "a norn workflow" is never a hit.
- D5 **Link check (B36, B37).** It covers every markdown file in the repo, except dependencies, story specs and their runs (their links point at code as it was) and CHANGELOG (historic). For each relative link it resolves the path from the linking file and requires that it exists. When the link has an `#anchor` and points at a markdown file, the anchor must match a heading slug of that file, computed the way GitHub does (lowercase, punctuation dropped, spaces to hyphens, repeated headings numbered). Links with a scheme (`https:`, `mailto:`) are skipped.
- D6 **Version check (B38).** It covers the README, CONTRIBUTING, AGENTS, every doc under the docs folder, the rules file and the Herdr plugin README. A hit is a three-part version (`0.17.0`, `v1.2.3`) or the words "as of release". It allows the README's release badge line and nothing else, and CHANGELOG is not scanned. Two-part tool requirements (git ≥ 2.38) are not hits.
- D7 **Tracked handoff check (B34).** A walk over the repo, excluding dependencies, fails on any file named handoff.md that is not inside a `runs/` folder of a story spec. It walks the file system, since the unit tier may not start git. An untracked stray file would fail locally too, which is what we want.
- D8 **Rule id pins (B24, B27).** A rule is defined by a list line starting with its id (`- S5 …`, `- R5.1 …`). The test pins, as a literal list, every id defined by the PRD and the four SPEC files at the start of the story. The rules file must define each one exactly once, and may define new ones only through a later story. The list is generated once while the old files still exist and committed in the test.
- D9 **Where the docs live.** The README stays at the root. Concepts, Reference, Recipes and Limitations go in the docs folder (with the logo asset that is already there). The rules file sits in `.agents/` where the PRD was. Limitations moves out of `.agents/`.
- D10 **Pointer updates (B31).** AGENTS.md's opening and Decisions, this repo's workflow instructions (refinement, quick, triage, reproduce), the `issue` skill (its "PRD" section of the issue body becomes "Rules") and the `release` skill, source comments, and the repo tests that read the PRD (the §15 command-table test reads the rules file). Shipped assets name no PRD and stay untouched.
- D11 **Output examples (B39) are captured from the released `norn`** in a throwaway repo under the temp dir, never a dev build and never in the unit worktree. Ids and paths are kept as they came out.
- D12 **Work order in the branch.** Prefactor, then the S1 checks with their matcher tests (most go red on today's docs, which shows they bite). Then the rules file and the deletions, then Reference and its generator, then README, Concepts, Recipes, Limitations, CONTRIBUTING and AGENTS. The branch ends green with every S1 sweep at zero hits.

### Testing decisions

- A good test here drives a matcher or the render with a small string and checks the hits or markdown it returns, then sweeps the real files expecting none. No test reads git, spawns `norn` or touches the network: everything is the unit tier.
- Nothing is mocked. The only system boundary is the file system, which the sweeps read for real; the matchers take strings.
- Each sweep's failure message names the file, the line and the fix (the regenerate command, the missing anchor, the unknown flag), as the existing lints do.
- An allowlist entry, where one is needed, carries file, line text and why, like the removed-command lint's.
- Content items (S3) are verified in review against the spec, and in QA by an agent following the README and each recipe with the released `norn`, rerunning every output example.

### Risks

- **The SPEC fold loses or garbles a rule.** This is the biggest risk: about 70 rules move, and amended ones are rewritten. D8's pinned id list catches a lost or duplicated id, but not a rule whose meaning changed. Review compares each moved rule with its source.
- **Command-mention false positives.** Doc code blocks include shell lines that are not norn commands, `$NORN` variables and placeholders. The matcher's string cases go first, and the allowlist stays small and justified.
- **GitHub's anchor slugs** differ from a naive slug for headings with backticks, punctuation or repeats. The matcher's string cases pin the cases the docs use.
- **Size of the diff.** A docs rewrite of this size is hard to review. The work order (D12) and keeping each doc's move and rewrite in its own commit help the reviewer.
- **Rules file name in the running unit.** This unit's pinned workflow still says "amend the PRD". Only later rounds read the new instruction, which is expected (S7).
