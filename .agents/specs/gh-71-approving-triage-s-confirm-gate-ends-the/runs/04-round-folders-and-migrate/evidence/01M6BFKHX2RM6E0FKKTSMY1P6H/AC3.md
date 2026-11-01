# AC3 (B34): flat record moved by round.migrate — pass

gh-9 was started and taken through implement by the RELEASED norn 0.15.0 (flat record: state.json,
workflow.yaml, receipts/0001,0002, evidence/<run>/proof.txt; handoff Goal/Progress/Resume written), parked at review.
First dev-build tick: decisions = [{rule: round.migrate, kind: round_migrate, ok: true}] (only action).
git log since: one commit "norn: gh-9 record moved into round 1" (trailers Norn-Story gh-9, Norn-Step review);
`git show --stat -M`: 5 files, all `{ => rounds/01-duo}/…` renames, 0 insertions/deletions.
origin's gh-9-round-thing == local HEAD (pushed); origin tree has only handoff.md + rounds/01-duo/… .
state.json before vs rounds/01-duo/state.json after: identical (step review, counters unchanged).
`norn status` (dev): gh-9 "review is ready (manual)" — same as released status before.
`run list gh-9` (dev): evidence path of the implement receipt ("evidence/<run>") resolves to
  …/runs/_story/rounds/01-duo/evidence/<run>.
Next tick: agent.ready.manual (goes on); the review step on the dev build wrote receipts 0003/0004 into rounds/01-duo.
Slice folders: the hand-run story had none; the integration test's fixture has a committed slice folder
runs/01-x/ asserted unchanged and an untracked logs/ file moved into rounds/01-duo/logs/ (passes).
