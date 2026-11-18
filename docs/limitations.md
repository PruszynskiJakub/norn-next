# Limitations

What norn does not do yet, what has not been proven in real use, and the limits of its design. What was fixed is in the [changelog](../CHANGELOG.md). Read this before relying on norn beyond the envelope below.

## Proven envelope

What the test tiers cover end to end, with real git, real processes and a scripted agent:
- One person, on **one machine**.
- The GitHub tracker and forge (over a scripted `gh`), or the local tracker with no forge.
- The local store; several stories in parallel on one base.
- The headless runner; manual or auto mode.
- Claude Code and pi as harnesses, held to the same recorded sessions.

The `refs` store shared by several clones is tested with clones on one machine only. Everything else below is either a known gap or unproven.

## Not built yet

- **No command sends a stuck unit back.** A stuck unit keeps its worktree and its item stays open, but no verb reruns its step, resets a counter or moves it to another step: close the story with `norn story close` and open a new item for what is left.
- **No generated-file resolution.** A base update whose only conflicts are in generated files (emitted schemas, a generated reference) goes to the workflow's agent resolve step like any other conflict; no config names a command that rewrites them instead.
- **No command starts a new round.** A story runs the workflow its intake label picks, from start to end; to follow a triage or refinement workflow with a delivery one, open a new item for it.
- **No handover verbs.** With the `refs` store another clone sees each story and its claim, and can drive a story once the claim expires, but no command releases a claim early or takes one over by hand.
- **No notifications and no live view.** Nothing tells you when a story starts waiting for you: keep `norn status` in view.
- **Secrets in pushed run data.** With the `refs` store, receipts, check output and the story's documents are pushed to the remote unredacted. Keep secrets out of check output.
- **No GitLab plugin.** The bundled tracker and forge are GitHub's and the local ones; another host needs a plugin ([Recipes: Write a plugin](recipes.md#write-a-plugin)).
- **One pack per repository.** The config names one pack; a repo's own workflows in `.agents/workflows/` lay over it.
- **No permission profiles per step.** Claude Code runs in its `auto` permission mode by default; a permission prompt the agent is blocked on shows up as a question.
- **The hooks are a reminder, not a sandbox.** In a unit worktree the harness's hook refuses a file-tool write outside the worktree or under norn's run state, and keeps the agent from ending a turn without a report (a few times a run, then the step's nudges take over), each with the rule's reason. It reads only file-tool writes, refuses no shell command, and lets anything but a guarded write through when it fails itself, so it is no security boundary. What it misses is still forbidden by the brief: shell writes under norn's run state, remote writes not on its list (it lists none: a `git push`, a `gh` call, a `curl`), and every norn command but `brief`, `done`, `ask` and `stuck`.
- **No guards on transitions** (`when:`), no per-slice mode, no `fork`/`join` steps: conditions are outcomes, a person's QA is a gate, and `attended: true` on a step covers the precise cases.
- **Cost per story** is not tracked.

## Not yet proven in real use

- **Two real machines.** Claims and the mailbox on the `refs` store are git refs with compare-and-swap, which is sound on paper and passes its contract suite, but no two real machines have shared a story.
- **The herdr runner.** Its test against a real Herdr runs only when asked (`NORN_TEST_HERDR=1`), never in CI, and no long dogfood run has used it yet.
- **Real agents in long runs.** The live canary runs one real turn of each agent tool when asked (`NORN_TEST_LIVE=1`); pi in particular has run few real stories, and reports no subagents and no usage limits, so norn cannot wait on either for it.
- **A browser criterion checked live.** Nobody has yet had an agent with a browser pass a criterion seen in a web page.

## Limits of the design

- **Agents report their own work.** A receipt records what the agent claimed. Gates and checks are only as strong as the commands you configure, and a weak check lets anything through.
- **Decide never reads prose.** Anything that lives only in a spec body, a handoff or a review comment does not influence the next step unless an agent turns it into a typed outcome.
- **Corrupt means stopped.** A record that fails validation marks the unit `corrupt`, by design. Hand edits to norn's run data block the unit until a person repairs it.
- **Trackers and forges hold no state.** Labels and comments norn writes on an issue are for people; norn reads its decisions only from the store. A story's workflow is read from its label once, at intake, and editing a label later never moves a story.
- **Merge, never rebase.** Story branches gain merge commits from the base. Teams that require linear history must squash on merge; the base then stays linear.
- **Coarse grain.** norn works per story and slice on a heartbeat. It is the wrong tool for quick interactive edits, and the overhead is not worth it for tiny changes.
- **Workflows are pinned per unit.** Editing a workflow does not affect units already in flight. This is intended, but surprising.
- **Nothing stops a person typing into an agent's pane.** With the herdr runner, an answer typed there bypasses norn's record: give decisions with `norn story answer` too.
- **The local environment must stay healthy.**
  - It needs git ≥ 2.38, disk for one worktree per running unit, and the tools `norn doctor` names for the config: `gh` signed in for GitHub, the agent tool, `herdr` for the herdr runner. Check commands must do their own setup in a fresh worktree, such as `bun install --frozen-lockfile`.
  - Rate limits or a GitHub outage stop observation of the tracker and forge.
  - A sleeping laptop pauses every watch, and claims expire. They are taken again cleanly after wake, but nothing moves in the meantime.
- **Observability covers only what goes through norn.** The trace records every tick's facts and decisions. Anything a person or agent does outside norn, such as pane keystrokes or hand merges, shows up only as facts observed later, without the reason.
