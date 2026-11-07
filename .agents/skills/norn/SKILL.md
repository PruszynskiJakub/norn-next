---
name: norn
description: The protocol for doing one norn step and reporting it once with `norn done`, `norn ask` or `norn stuck`. Use when told to use the norn skill and run `norn brief`, when the working directory has a `.norn-unit` file, or when asked to continue a norn step.
---

# norn: one step, one report

Run `norn brief` in this worktree and follow it. The brief is the whole step: the skill to use, what sent the work back, how to finish, what to read, the handoff and the unit's history, and How to work (scope, the handoff, reporting once, the hard rules). Nothing else needs reading to find your bearings.

If it refuses because this is not a unit worktree (the repo's main checkout, say), stop and tell the person to start the agent from the unit's item in `norn status` (`norn story start <unit>` opens or prints it). Never change directory to look for the work yourself.

Resumed with an answer, or unsure where the step stands, run `norn brief` again: it is rendered from the unit's state each time.
