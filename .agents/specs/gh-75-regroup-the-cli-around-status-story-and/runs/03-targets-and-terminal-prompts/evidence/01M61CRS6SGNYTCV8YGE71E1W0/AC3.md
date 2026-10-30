## status order
gh-1 Pay invoices
  gated Â· auto Â· mine Â· running work#1 0s [loop 0/2]
  base main: up to date

gh-2 Split work
  sliced Â· auto Â· mine Â· ready slices#1 0s
  âM-^FM-^R norn brief
  base main: up to date
  gh-2/01    First part âM-^@M-^T parked qa#1 (gate: Try the slice) 0s
      âM-^FM-^R norn approve gh-2/01

Runs
  gh-1       work#1 auto claude dead since 2099-01-15T10:00:40.000Z

heartbeat: last tick 0s ago on tester@box
1 item needs you âM-^@M-^T norn inbox
Approve (1) Â· gates waiting for your decision
  gh-2/01    qa: Try the slice Â· 0s
      or reject: norn approve gh-2/01 --reject --reason "âM-^@¦"
      $ norn approve gh-2/01

Running (2) Â· agents and checks at work
  gh-1       work #1 (auto) Â· 0s
      $ norn trace gh-1
  gh-2       slices #1 (queued) Â· 0s
      $ norn trace gh-2

## AC3: pty, Down Down Enter on run view
norn run view: which unit? (âM-^FM-^Q/âM-^FM-^S, Enter to pick, Esc to leave)^M
^[[2K> gh-2/01  qa: Try the slice^M
^[[2K  gh-1  work #1 (auto)^M
^[[2K  gh-2  slices #1 (queued)^M
^[[3A^[[2K  gh-2/01  qa: Try the slice^M
^[[2K> gh-1  work #1 (auto)^M
^[[2K  gh-2  slices #1 (queued)^M
^[[3A^[[2K  gh-2/01  qa: Try the slice^M
^[[2K  gh-1  work #1 (auto)^M
^[[2K> gh-2  slices #1 (queued)^M
gh-2 Â· slices#1 (slices)^M
^M
run      -^M
outcome  (in step)^M
entered  2099-01-15T10:01:20.000Z^M
left     âM-^@¦^M
duration 0s so far^M
who      -^M
[exit 0]

## AC3: pty, j Enter on run list
norn run list: which unit? (âM-^FM-^Q/âM-^FM-^S, Enter to pick, Esc to leave)^M
^[[2K> gh-2/01  qa: Try the slice^M
^[[2K  gh-1  work #1 (auto)^M
^[[2K  gh-2  slices #1 (queued)^M
^[[3A^[[2K  gh-2/01  qa: Try the slice^M
^[[2K> gh-1  work #1 (auto)^M
^[[2K  gh-2  slices #1 (queued)^M
gh-1 Â· Pay invoices Â· running at work^M
intake 2099-01-15 10:00:10Z Â· not done Â· wall-clock 0s so far^M
time in steps: agent 0s Â· human wait 0s^M
(6 no-op/claim-renew tick events hidden âM-^@M-^T --all shows them)^M
^M
UNIT  STEP    ENTERED   LEFT  DUR  OUTCOME    WHO^M
gh-1  work#1  10:00:30  âM-^@¦     0s+  (in step)  tick 03PGFN38A05SE3DM24EJFSYR2J^M
[exit 0]
