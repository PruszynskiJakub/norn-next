norn — deliver software stories with coding agents; code decides the next step, agents do it.

Agent doing a norn step? Run only `norn brief`, then report once with `norn done`, `norn ask` or `norn stuck`
(the `norn` skill says how). Every other command is the person's: run one only when the person asks you to directly.

Start here
  norn init              Set up norn in this repository: config, workflows, skills, hooks
  norn doctor            Check agents, hooks, skills, remote auth and runner on this machine; --live runs one test turn per agent
  norn sync              Sync the remote now and take in new stories
  norn watch             Run ticks in a loop; a clean exit releases held claims
  norn status            What needs you, grouped by action, with the command to resolve each item; --history for when items came and went
  norn open              Open an agent on the step a person starts: a Herdr tab in the unit worktree, or the command to run

Answer what needs you
  norn answer            Answer the question a unit is parked on; a prompt in an agent's pane gets the keys it expects
  norn approve           Approve (or --reject) the gate a unit waits at
  norn unstick           Resume a stuck unit, optionally --to a step and --reset counters
  norn update            Send a waiting story back through its base update: done with an unmerged PR, at a gate, or stuck
  norn mode              Switch a story between auto and manual mode
  norn workflow          Choose a unit's workflow before start, or switch it with --to after start

Look around
  norn cockpit           What needs you and every story, with the actions each offers: approve, answer, orient, go to the agent
  norn story             The stories of this repository (list)
  norn orient            One story at a glance: slices, PR, open notes, what waits for you; --open gives it a Herdr workspace with an agent
  norn run               The runs of a unit: its step timeline, one run, why a tick decided what it did (list, view)
  norn config            Show the resolved config and which file set each value
  norn tick              One heartbeat pass: observe, decide, act, log

Team
  norn take              Take over a story on this machine: claim it, check out its branches, print the handoff
  norn release           Hand a story over: push branches and handoff, then delete the claim
  norn drop              Drop a story: push its branches, then remove worktrees, local branches and the claim; the record stays

Housekeeping
  norn tidy              Report or clean orphan worktrees, branches, stale leases, receipt reservations, runs/ work not in the record and Herdr panes of runs that reported done
  norn uninstall         Remove norn-owned hooks and skills; keep config, workflows and specs
  norn help              List commands, and who runs each: a person or the agent

Run by Herdr, not by hand
  norn status --segment  One line for Herdr's tab bar; sorts and marks the orient workspaces

Agent protocol: the only commands an agent runs
  norn brief             Brief the agent on the current step of this worktree's unit; starts the run in manual mode
  norn done              Report that the current step finished with a declared outcome; then end your turn
  norn ask               Report that the step needs a person's answer to continue; then end your turn
  norn stuck             Report that the step cannot continue; then end your turn

Called by the agent's hooks, not by hand
  norn hook              Agent hook entry point: record a lifecycle fact; refuse an unreported turn end

Skills (in .agents/skills/; only an agent loads one, the one its brief names)
  the protocol, loaded first in every step: norn
  step skills, the agent works alone: norn-implement, norn-review, norn-qa, norn-merge, norn-slice, norn-pr, norn-diagnose
  step skills, a person works with the agent: norn-refine, norn-clarify, norn-plan, norn-interview, norn-qa-person, norn-prototype
  references other skills read, never a step: norn-tdd, norn-codebase-design
  other skills: norn-retro

New here? `norn init` in your repository, then follow the steps it prints.
`norn help <command>` shows one command's usage; add `--json` to any command for data.
