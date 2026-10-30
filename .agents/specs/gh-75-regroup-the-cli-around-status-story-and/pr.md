## Summary

norn's 29 flat commands become a gh-style noun tree: `status` (what needs you), `story <verb>` and `run <verb>`, plus setup, background and the unchanged agent protocol. It adds `story create`, `story reopen`, `run cancel` and `config set|unset`. Old names are removed with no aliases. Every command norn prints, every doc, the Herdr plugin and the PRD use the new names.

```diff
 norn help
-  status  inbox  cockpit  orient  trace  why  open  answer  approve  update
-  mode  workflow  take  release  drop  unstick  config [<key>]  …
+  Core          status [--watch [--pane]] [--history] [--segment]
+                story   create list view | answer approve reject update-branch
+                        | start chat edit | checkout handoff close reopen
+                run     list view attach rerun cancel
+  Setup         init doctor config list|get|set|unset uninstall
+  Background    watch sync tidy
+  Agent protocol brief done ask stuck          (unchanged)
+  help --all    tick hook status --segment
```

The verbs take an optional target: an explicit key, else this worktree's unit (the story for story-only verbs). Otherwise, at a terminal, a pick-list of only the units the verb applies to. Under `--json`, with no TTY or in an agent session, a missing target is refused and the error lists the candidates (`packages/cli/src/runtime/target.ts`). The spec's "Map from today's commands" table gives each old name's replacement.

Evidence root: [`runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ`](https://github.com/PruszynskiJakub/norn-next/tree/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ) (qa#3 on the HEAD after the main merge; [report.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/report.md)). `ev/` holds the branch CLI run in a throwaway repo, side by side with the released 0.11.1. `e1/`, `e3/`, `e69/` and `ec/` hold flows that need stories, driven through `runCli` on the integration harness (real git, fake remote, runner and terminal). The full suite passed 1421/0. Result: 63 pass, 0 fail. A person checked the remaining 8 (B12, B17, B18, B19, B23, B29, B46, B47) at human-qa#2.

## Evidence

Paths are relative to the evidence root.

**Help and the shape of the surface**

- **B1** `norn help` in tiers
  **Before:** 29 flat commands.
  **After:** Core (`status`, `story`, `run`), Setup, Background, Agent protocol, then skills; `tick` and `hook` not listed. [ev/B1.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ev/B1.md)
- **B2** `norn story` / `norn run` list their verbs, grouped
  **Before:** did not exist.
  **After:** general / decision / work / team groups, exit 0. [ev/B2.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ev/B2.md)
- **B3** `help --all` adds `tick`, `hook`, `status --segment`
  **Before:** did not exist.
  **After:** observed. [ev/B3.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ev/B3.md)
- **B4** `help story reject` / `--help` shows one verb's usage
  **Before:** did not exist.
  **After:** `norn story reject [<story|slice>] --reason "…"` with its options. [ev/B4.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ev/B4.md)
- **B5** Old names are unknown commands
  **Before:** `norn drop gh-12` cancelled the story.
  **After:** `drop`, `inbox`, `cockpit`, `orient`, `open`, … → `unknown_command`, exit 2, do_instead `norn help`. [ev/B5.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ev/B5.md)
- **B6** Every `list`/`view` takes `--json`
  **After:** observed. [e1/B6.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B6.md)
- **B7** Printed commands use the new names
  **Before:** inbox items printed `norn approve`, `norn unstick`.
  **After:** inbox, do_instead, `doctor`/`init` next steps print `norn story approve`, `norn run rerun`, …. The `printed-commands` test pins every builder. [ev/B7.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ev/B7.md), [ev/B7-doctor.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ev/B7-doctor.md)
- **B8** Docs and the Herdr plugin use the new names
  **After:** `test/repo.test.ts` lints shipped docs, skills, the plugin and the PRD for old command names. It is green, and the plugin's cockpit action runs `norn status --watch --pane`. [ev/B8-B71-lint.txt](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ev/B8-B71-lint.txt)

**`norn status`**

- **B9** `status` is the inbox
  **Before:** `norn inbox`.
  **After:** same groups and commands as released `inbox`. [e1/B9.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B9.md), [ev/B9-B10-released.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ev/B9-B10-released.md)
- **B10** `--details`, `--notes`, `--history [--since]`, `--json` carried over
  **After:** output matches released `inbox`. [e1/B10.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B10.md)
- **B11** `status --watch` is the cockpit
  **Before:** `norn cockpit`.
  **After:** full-screen cockpit until q or Esc, recorded on a terminal. [ev/B11.typescript](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ev/B11.typescript), [ec/B11-harness.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ec/B11-harness.md)
- **B12** `status --watch --pane` under Herdr
  **After:** QA saw only the refusal outside Herdr: exit 3 `not_in_herdr`, do_instead `norn status --watch` ([ev/B12.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ev/B12.md)). The pane itself was checked by a person in Herdr (human-qa#2). There is no agent evidence.
- **B13** One-time notice about the move
  **After:** the first run prints the notice on stderr. The second run doesn't, and stdout/`--json` are unaffected. [ev/B13.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ev/B13.md), [ev/B13-fresh.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ev/B13-fresh.md)
- **B14** `status --segment` unchanged
  **Before / After:** `norn·repo ✓ nothing waits` from both 0.11.1 and the branch. [ev/B14.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ev/B14.md)

**`norn story` — general**

- **B15** `story list` is the old `status` table
  **After:** same table; `--json` top-level keys identical to 0.11.1 `status --json`. [e1/B15.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B15.md), [ev/B70.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ev/B70.md)
- **B16** `story view` merges `status <key>` and `orient`
  **After:** slices with steps, PR link and state, open notes, waiting items. [e1/B16.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B16.md), [ec/B16-pr.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ec/B16-pr.md)
- **B17** `story view --web`
  **After:** not shown by QA, which had no browser. A person checked it after release (human-qa#2).
- **B18** `story create` creates, labels, assigns and takes in the issue
  **After:** on the harness's fake remote, #81 was created with `norn` and `norn:wf:…`, assigned and taken in ([e1/B18-harness.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B18-harness.md)). A person checked it on a throwaway private GitHub repo: the issue got both labels and the assignee, and status listed it as new (gh-75/12 AC8).
- **B19** Interactive `story create` (title prompt + `$EDITOR`)
  **After:** an empty title creates nothing, exit 2 ([ev/B19-empty-title.typescript](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ev/B19-empty-title.typescript)). A person judged the real editor round trip in gh-75/12 QA.
- **B20** `story create` without `--title`, no TTY → refused
  **After:** exit 2, do_instead "pass --title". [ev/B20.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ev/B20.md)
- **B21** Unknown `--workflow` refused before anything is created
  **After:** exit 3 listing workflows; no remote issue. [e1/B21-harness.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B21-harness.md)
- **B22** Remote failure leaves nothing locally
  **After:** error names the remote failure, do_instead `norn doctor`; no story taken in. [e1/B22-harness.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B22-harness.md)
- **B23** `story create --web`
  **After:** not shown by QA, which had no browser or real remote. A person checked it after release (human-qa#2). Earlier, gh-75/12 AC8 saw exit 0 with url `…/issues/new?labels=norn%2Cnorn%3Awf%3Astory` and no issue created.

**`norn story` — decision**

- **B24** `story answer` ([e1/B24.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B24.md)), **B25** `story approve` ([e1/B25.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B25.md)), **B27** `story update-branch` ([e3/B27.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e3/B27.md))
  **Before:** `norn answer`, `norn approve`, `norn update`.
  **After:** each writes the same receipts and gives the same refusals under the new name.
- **B26** `story reject --reason` required
  **Before:** `approve --reject`.
  **After:** reject receipt carries the reason; without `--reason` → exit 2, do_instead "pass --reason". [e1/B26.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B26.md)

**`norn story` — work**

- **B28** `story start [--print]`
  **Before:** `norn open`.
  **After:** opens a tab through a runner that can open terminals (fake); `--print` prints the command. [e3/B28.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e3/B28.md), [ec/B28-open.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ec/B28-open.md)
- **B29** `story chat`
  **Before:** `orient --open`.
  **After:** not shown by QA, which had no Herdr. A person checked it in Herdr after release (human-qa#2).
- **B30** `story edit --auto|--manual` ([e1/B30.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B30.md)), **B31** `--workflow` before start ([e1/B31.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B31.md)), **B32** `--at` required once started ([e1/B32.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B32.md))
  **Before:** `norn mode`, `norn workflow [--to]`.
  **After:** mode receipt; workflow set; switch journaled as before. Passing both `--auto` and `--manual` → exit 2. Switching a started unit without `--at` → refused naming `--at`.

**`norn story` — team**

- **B33** `story checkout` ([e1/B33.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B33.md), [ec/B33-cross.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ec/B33-cross.md)), **B34** `story handoff` ([ec/B34-cross.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ec/B34-cross.md))
  **Before:** `norn take`, `norn release`.
  **After:** in a two-checkout flow, A hands off and B checks out. Without `--force`, a live claim from another machine is refused.
- **B35** `story close` has `drop`'s effects
  **After:** branch pushed; worktree, local branch and claim gone; remote branch kept; issue still open. [e1/B35.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B35.md)
- **B36** Asks before closing at a terminal
  **After:** answering N changes nothing, exit 0. Minor wording: "Worktrees for 1 units". [e1/B36.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B36.md)
- **B37** `--json`/no TTY without `--yes` refused ([e1/B37.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B37.md)), **B38** another machine's claim refused ([e1/B38.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B38.md)), **B39** second close refused `already_closed` ([e1/B39.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B39.md))
  **After:** all exit 3, nothing changes.
- **B40** `story reopen` undoes a close
  **Before:** did not exist (a drop was final).
  **After:** claim re-taken here, worktree re-created from the pushed branch, unit back at its step. [e1/B40.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B40.md), [ec/B40-gate.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ec/B40-gate.md)
- **B41** A unit that was running comes back stuck
  **After:** after reopen and one tick, the unit is `stuck` with reason `reopened` under Unblock, and `norn run rerun gh-1` is offered. [e1/B41.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B41.md)
- **B42** Reopen refusals
  **After:** `not_closed`, `branch_missing` (names the branch), closed issue → "reopen the issue first"; all exit 3. [e1/B42.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B42.md)

**`norn run`**

- **B43** `run list` ([e1/B43.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B43.md)), **B44** `run view` ([e1/B44.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B44.md)), **B45** `run view --why` / `--receipt` ([e1/B45.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B45.md))
  **Before:** `norn trace`, `norn why`, `why --receipt`.
  **After:** same timeline and replay. `run view` shows one run, and a unit key means its latest run.
- **B46** `run attach`, **B47** `run attach --next`
  **Before:** `cockpit --next` (B47); B46 did not exist.
  **After:** not shown by QA, which had no Herdr. A person checked both in Herdr after release (human-qa#2).
- **B48** `run rerun` ([e1/B48.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B48.md)), **B49** `run rerun --step` ([e1/B49.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B49.md))
  **Before:** `norn unstick`, `unstick --to`.
  **After:** resumes in a fresh session; `--step` moves the unit.
- **B50** `run rerun` on a running unit refused
  **After:** exit 3, do_instead `norn run cancel gh-…`. [e1/B50.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B50.md)
- **B51** `run cancel` stops the agent, not the story
  **Before:** only `drop`, which cancelled the story.
  **After:** the person's `0003-stuck.json` receipt was on disk when kill ran (P6). The unit shows `stuck: cancelled by person` under Unblock, with no relaunch after 2 ticks. [e1/B51.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B51.md)
- **B52** `run cancel` keeps everything else
  **After:** commits, uncommitted work, branch and claim are all kept, and `run rerun` resumes in a fresh session ([e1/B52.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B52.md)). Under Herdr, cancel closes the pane: `herdr pane close` is the runner's kill, which a person accepted at gh-75/09 human-qa.
- **B53** Nothing to cancel / not my claim refused
  **After:** `nothing_to_cancel`; other holder → do_instead `norn story checkout`; exit 3. [e1/B53.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B53.md)

**Targets and prompts**

- **B54** Default to the worktree's unit ([e1/B54.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B54.md)), **B55** story-only verbs act on the slice's story ([e3/B55.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e3/B55.md)), **B56** an explicit target wins ([e1/B56.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B56.md))
  **Before:** every command took a key.
  **After:** observed as specified.
- **B57** Pick-list of only applicable units ([e1/B57.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B57.md)), **B58** shown even for one, preselected ([e1/B58.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B58.md)), **B59** none applicable → refused ([e1/B59.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B59.md))
  **After:** `story approve` offered `gh-2`, `gh-4/01` only (the units at gates); Esc → `cancelled`.
- **B60** No prompt under `--json`, no TTY or an agent session
  **After:** `target_required`, exit 2, do_instead `norn story approve gh-2 | norn story approve gh-4/01`; no receipt written. [e1/B60.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e1/B60.md)

**`norn config`**

- **B61** `config list` / `config get <key>`
  **Before:** `norn config [<key>]`.
  **After:** value and layer shown. [ev/B61.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ev/B61.md)
- **B62** `config set --user|--repo` ([ev/B62.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ev/B62.md)), **B63** dotted keys, YAML values, lists whole ([ev/B63.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ev/B63.md))
  **Before:** did not exist (hand-edited YAML).
  **After:** the value is written and `config get` shows it from that layer. Note: setting `agents.claude.model` in the repo file writes the whole resolved `agents.claude` entry (adapter, args).
- **B64** Asks which file at a terminal ([ev/B64.typescript](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ev/B64.typescript)); **B65** refused under `--json`/no TTY, exit 2 ([ev/B65.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ev/B65.md))
- **B66** Unknown key / invalid value refused, file unchanged
  **After:** `invalid_value` (`/slots/max must be integer`), `unknown_key`; sha of both files identical before and after. [ev/B66.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ev/B66.md)
- **B67** Comments and key order kept
  **After:** `config set limits.deadline 2h --repo` → git diff of the commented file is exactly `-deadline: 90m` / `+deadline: 2h`. [ev/B67.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ev/B67.md)
- **B68** `config unset`
  **After:** the key is removed and the next layer shows through. Unsetting a missing key is a no-op, exit 0. [ev/B68.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ev/B68.md)

**What stays**

- **B69** `brief`, `done`, `ask`, `stuck`, `hook` unchanged
  **After:** an agent's `brief` → `done` works as before, and usage is identical to 0.11.1. [e69/B69.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/e69/B69.md), [ev/B69-usage.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ev/B69-usage.md)
- **B70** Persisted formats and `--json` shapes unchanged
  **After:** `receipt.ts`, `state.ts`, `trace.ts` and `workflow.ts` changed in comments only. The one new file is `trace/notices.json` (B13). `story list --json` and `status --json` keys match 0.11.1's `status --json` and `inbox --json`. Existing golden decide cases change only in printed command strings (`inbox` → `status`, `status` → `story list`); two cases for `run cancel` are new. The effect transcripts change only in the hashes of text files whose printed commands changed. [ev/B70-schema.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ev/B70-schema.md), [ev/B70.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ev/B70.md)
- **B71** PRD §15 is the noun tree; rules name new commands
  **After:** `.agents/PRD.md` is rewritten. The repo lint fails on any old command name in it and is green. [ev/B8-B71-lint.txt](https://github.com/PruszynskiJakub/norn-next/blob/gh-75-regroup-the-cli-around-status-story-and/.agents/specs/gh-75-regroup-the-cli-around-status-story-and/runs/_story/evidence/01M64YKC8RVEVX0Q58A7R7W7BZ/ev/B8-B71-lint.txt)

## Merge danger

**Door:** two-way for data, one-way for users once released. A revert restores the old commands. Receipts, `state.json` and traces are unchanged, so no unit needs migrating either way. But once a release ships, anyone who learned the new names, or whose scripts call them, loses them on a revert.

**Blast radius:** every CLI user. With no aliases, old names exit 2 `unknown_command` (B5), which breaks:
- shell scripts and muscle memory that call `inbox`, `approve`, `unstick`, `drop`, …;
- an older Herdr plugin install, whose actions call `norn cockpit`/`open` until the plugin is updated with the binary.

Agents and installed hooks keep working (B69), and JSON shapes are kept (B70). `norn status` now means the inbox, not the story table; the one-time notice (B13) points people to `story list`.
