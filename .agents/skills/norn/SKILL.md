---
name: norn
description: Sends an agent in a norn unit worktree to `norn brief`, which holds the step, how to report it once (`norn done`, `norn ask`, `norn stuck`) and the rules. Use when the working directory has a `.norn-unit` file, when told to run `norn brief`, or when asked to continue a norn step.
---

# norn: one step, one report

Run `norn brief` in this worktree and follow it. The brief is the whole step: the skill to use, what sent the work back, how to finish, what to read, the handoff and the unit's history, and How to work (scope, the handoff, reporting once, the hard rules). Nothing else needs reading to find your bearings.

If it refuses because this is not a unit worktree (the repo's main checkout, say), stop and tell the person to start the agent from the unit's item in `norn status` (`norn story start <unit>` opens or prints it). Never change directory to look for the work yourself.

Resumed with an answer, or unsure where the step stands, run `norn brief` again: it is rendered from the unit's state each time.
