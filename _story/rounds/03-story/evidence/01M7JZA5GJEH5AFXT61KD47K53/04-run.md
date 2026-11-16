### after send-back 1: state
{
 "step": "implement",
 "status": "ready",
 "counters": {
  "review.changes_requested": 1
 },
 "park": null
}

### norn status (counter 1/3)
Running (2) · agents and checks at work
  gh-7       round 1 · legacy · implement #1 (auto) · 1m
      $ norn run list gh-7
  gh-8       round 1 · build · implement #2 (queued) · 0s
      $ norn run list gh-8


### norn story list (counter 1/3)
gh-7 Old unit
  legacy · auto · mine · running implement#1 1m [ready_loop 0/3]
  base main: 1 behind

gh-8 New unit
  build · auto · mine · ready implement#2 0s [review.changes_requested 1/3]
  → cd /private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-0uJxmA/home/repos/repo-b6429624/worktrees/gh-8-new-unit && claude --permission-mode auto -- 'Run `norn brief` in this worktree and do the step it gives you.'
  base main: up to date

Runs
  gh-7       implement#1 auto claude alive since 2099-01-15T10:00:40.000Z

heartbeat: last tick 0s ago on tester@box (took 522ms)
0 items need you — norn status


### norn story view gh-8 (counter 1/3)
# gh-8 — New unit

## The story

- Issue: https://github.com/o/r/issues/8
- Story: round 1 · build · ready at implement (last: review → changes_requested) · auto · held here
- Worktree: `/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-0uJxmA/home/repos/repo-b6429624/worktrees/gh-8-new-unit` · branch `gh-8-new-unit`
- Spec: `/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-0uJxmA/home/repos/repo-b6429624/worktrees/gh-8-new-unit/.agents/specs/gh-8-new-unit`

## Slices

No slices yet.

## Pull request

- none seen yet
- Look: `gh pr view gh-8-new-unit`; open it in the browser: `norn story view gh-8 --web`

## Waits for the person

Nothing waits for the person.

## Running

- gh-8 (implement), 0s: implement #2 (queued)

## Open notes (0)

No open notes.

## Where to look

- Spec folder: `/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-0uJxmA/home/repos/repo-b6429624/worktrees/gh-8-new-unit/.agents/specs/gh-8-new-unit`
- Every step and who acted: `norn run list gh-8`
- Why norn did what it did: `norn run view gh-8 --why`
- Status: `norn story view gh-8`


### other machine (not holder): norn status
Held elsewhere (2) · in another checkout
  gh-7       Old unit · held by tester@box · Step: implement (attempt 1) [ready_loop 0/3]
      $ norn story view gh-7
  gh-8       New unit · held by tester@box · Step: implement (attempt 2) [review.changes_requested 1/3]
      $ norn story view gh-8


### other machine (not holder): norn story view gh-8
- gh-8: Step: implement (attempt 2), ready · counters: review.changes_requested 1/3

### norn brief at implement after send-back 1 (Last round lines)
You are here because `review.changes_requested` sent the work back (fix round review.changes_requested 1/3). Address the points below first.

### after send-back 2: state
{
 "step": "implement",
 "status": "ready",
 "counters": {
  "review.changes_requested": 2
 },
 "park": null
}

### norn brief at implement after send-back 2 (Last round lines)
You are here because `review.changes_requested` sent the work back (fix round review.changes_requested 2/3). Address the points below first.

### after send-back 3: state
{
 "step": "implement",
 "status": "ready",
 "counters": {
  "review.changes_requested": 3
 },
 "park": null
}

### norn brief at implement after send-back 3 (Last round lines)
**Last round on `review.changes_requested` (3/3):** if the work is sent back along it once more, the unit goes stuck.
You are here because `review.changes_requested` sent the work back (fix round review.changes_requested 3/3). Address the points below first.

### after send-back 4: state
{
 "step": "review",
 "status": "stuck",
 "counters": {
  "review.changes_requested": 3
 },
 "park": {
  "kind": "exhausted",
  "reason": "review.changes_requested 3/3 at review.changes_requested",
  "since": "2099-01-15T10:03:40.000Z",
  "receipt_id": "03PGFN8R30SRXX522PH91Z1868",
  "counter": {
   "name": "review.changes_requested",
   "max": 3,
   "outcome": "changes_requested",
   "to": "implement"
  }
 }
}

### norn status (exhausted)
Unblock (1) · stuck or broken, needs you to unstick it
  gh-8       round 1 · build · review: review.changes_requested 3/3 at review.changes_requested · 10s
      $ norn run rerun gh-8 --step implement --reset review.changes_requested

Running (1) · agents and checks at work
  gh-7       round 1 · legacy · implement #1 (auto) · 3m
      $ norn run list gh-7


### pinned workflow of gh-8 (from state dir)


### rerun --reset review_loop (unknown)
{
 "exit": 3,
 "value": {
  "error": "unknown counter(s) review_loop in workflow build",
  "do_instead": "norn run rerun gh-8 --reset <review.changes_requested>",
  "code": "unknown_counter"
 }
}

### rerun --reset review.changes_requested
{
 "exit": 0,
 "stdout": "{\"unit\":\"gh-8\",\"receipt\":{\"kind\":\"unstick\",\"receipt_id\":\"03PGFN91VG3FWHA93MY6H86X78\",\"run_id\":\"03PGFN8R30SNQ0TG4H04989ZSY\",\"step\":\"review\",\"attempt\":4,\"at\":\"2099-01-15T10:03:50.000Z\",\"by\":\"human\",\"who\":\"tester@box\",\"slice\":null,\"round\":1,\"reset\":[\"review.changes_requested\"]},\"delivered\":{\"via\":\"local\",\"claim\":\"mine\",\"n\":25,\"file\":\"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-0uJxmA/home/repos/repo-b6429624/runs/gh-8/_story/rounds/01-build/receipts/0025-unstick.json\"},\"next\":\"norn tick\"}\n"
}

### after rerun: state
{
 "step": "review",
 "status": "running",
 "counters": {
  "review.changes_requested": 0
 }
}

### old unit counters after a send-back
{
 "ready_loop": 1
}

### old unit: rerun --reset ready_loop
{
 "exit": 0,
 "stdout": "{\"unit\":\"gh-7\",\"receipt\":{\"kind\":\"unstick\",\"receipt_id\":\"03PGFNAWEG5JQPXSV3DY8R2FVZ\",\"run_id\":null,\"step\":\"implement\",\"attempt\":2,\"at\":\"2099-01-15T10:04:50.000Z\",\"by\":\"human\",\"who\":\"tester@box\",\"slice\":null,\"round\":1,\"reset\":[\"ready_loop\"]},\"delivered\":{\"via\":\"local\",\"claim\":\"mine\",\"n\":8,\"file\":\"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-0uJxmA/home/repos/repo-b6429624/runs/gh-7/_story/rounds/01-legacy/receipts/0008-unstick.json\"},\"next\":\"norn tick\"}\n"
}

### old unit after rerun
{
 "step": "implement",
 "counters": {
  "ready_loop": 0
 }
}

### doctor (dev build) on this repo: workflow lines
  ok   workflows      build, legacy, quick, refinement, reproduce, slice, story, triage valid (.agents/workflows/)

### run state dir of gh-8
/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-0uJxmA/home/repos/repo-b6429624/runs/gh-8/_story/rounds/01-build

### pinned workflow.yaml
name: build
start: implement
steps:
  implement:
    agent: Build it.
    skills:
      - norn-implement
    outcomes:
      done: review
    means:
      done: built
  review:
    agent: Review it.
    skills:
      - norn-review
    outcomes:
      approve: $done
      changes_requested:
        to: implement
        counter: review.changes_requested
    means:
      approve: good
      changes_requested: rework
counters:
  review.changes_requested:
    max: 3


### receipt receipts/0025-unstick.json
{"kind":"unstick","receipt_id":"03PGFN91VG3FWHA93MY6H86X78","run_id":"03PGFN8R30SNQ0TG4H04989ZSY","step":"review","attempt":4,"at":"2099-01-15T10:03:50.000Z","by":"human","who":"tester@box","slice":null,"round":1,"reset":["review.changes_requested"]}
