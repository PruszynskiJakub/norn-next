

######## attended=false mode=auto runner=herdr
- opening line before Where: ["# norn brief — gh-1/02 · implement #1","","You do one step of a larger delivery and report how it ended, once; code decides what happens next.",""]
- order where<work: true
- contains 'Mode:' line: false
- contains 'Attended step' banner: false
- contains 'supervisor': false

## Where you run

- You run unattended in a herdr pane: no person reads this session. A question goes through `norn ask`, which parks the step until a person answers it.
- A permission prompt parks the step until a person answers it: prefer actions that need none.
- Mode auto: your report starts the next step at once. The next agent has only the handoff and the receipts, so write a handoff that stands on its own.



######## attended=false mode=auto runner=headless
- opening line before Where: ["# norn brief — gh-1/02 · implement #1","","You do one step of a larger delivery and report how it ended, once; code decides what happens next.",""]
- order where<work: true
- contains 'Mode:' line: false
- contains 'Attended step' banner: false
- contains 'supervisor': false

## Where you run

- You run unattended in a headless session: no person reads this session. A question goes through `norn ask`, which parks the step until a person answers it.
- A permission prompt parks the step until a person answers it: prefer actions that need none.
- Mode auto: your report starts the next step at once. The next agent has only the handoff and the receipts, so write a handoff that stands on its own.



######## attended=false mode=auto runner=null
- opening line before Where: ["# norn brief — gh-1/02 · implement #1","","You do one step of a larger delivery and report how it ended, once; code decides what happens next.",""]
- order where<work: true
- contains 'Mode:' line: false
- contains 'Attended step' banner: false
- contains 'supervisor': false

## Where you run

- This step is unattended: norn does not count on a person reading this session. A question goes through `norn ask`, which parks the step until a person answers it.
- A permission prompt parks the step until a person answers it: prefer actions that need none.
- Mode manual: the story asked for auto, but this machine has no runner, so nothing starts on its own: after your report, the next agent step waits for a person to start it.



######## attended=false mode=manual runner=herdr
- opening line before Where: ["# norn brief — gh-1/02 · implement #1","","You do one step of a larger delivery and report how it ended, once; code decides what happens next.",""]
- order where<work: true
- contains 'Mode:' line: false
- contains 'Attended step' banner: false
- contains 'supervisor': false

## Where you run

- You run unattended in a herdr pane: no person reads this session. A question goes through `norn ask`, which parks the step until a person answers it.
- A permission prompt parks the step until a person answers it: prefer actions that need none.
- Mode manual: after your report, the next agent step waits for a person to start it.



######## attended=false mode=manual runner=headless
- opening line before Where: ["# norn brief — gh-1/02 · implement #1","","You do one step of a larger delivery and report how it ended, once; code decides what happens next.",""]
- order where<work: true
- contains 'Mode:' line: false
- contains 'Attended step' banner: false
- contains 'supervisor': false

## Where you run

- You run unattended in a headless session: no person reads this session. A question goes through `norn ask`, which parks the step until a person answers it.
- A permission prompt parks the step until a person answers it: prefer actions that need none.
- Mode manual: after your report, the next agent step waits for a person to start it.



######## attended=false mode=manual runner=null
- opening line before Where: ["# norn brief — gh-1/02 · implement #1","","You do one step of a larger delivery and report how it ended, once; code decides what happens next.",""]
- order where<work: true
- contains 'Mode:' line: false
- contains 'Attended step' banner: false
- contains 'supervisor': false

## Where you run

- This step is unattended: norn does not count on a person reading this session. A question goes through `norn ask`, which parks the step until a person answers it.
- A permission prompt parks the step until a person answers it: prefer actions that need none.
- Mode manual: after your report, the next agent step waits for a person to start it.



######## attended=true mode=auto runner=herdr
- opening line before Where: ["# norn brief — gh-1/02 · implement #1","","You do one step of a larger delivery and report how it ended, once; code decides what happens next.",""]
- order where<work: true
- contains 'Mode:' line: false
- contains 'Attended step' banner: false
- contains 'supervisor': false

## Where you run

- A person works with you in this session: ask them here, not with `norn ask`, and report `done` only once they agree the work is finished.
- Mode auto: your report starts the next step at once. The next agent has only the handoff and the receipts, so write a handoff that stands on its own.



######## attended=true mode=auto runner=headless
- opening line before Where: ["# norn brief — gh-1/02 · implement #1","","You do one step of a larger delivery and report how it ended, once; code decides what happens next.",""]
- order where<work: true
- contains 'Mode:' line: false
- contains 'Attended step' banner: false
- contains 'supervisor': false

## Where you run

- A person works with you in this session: ask them here, not with `norn ask`, and report `done` only once they agree the work is finished.
- Mode auto: your report starts the next step at once. The next agent has only the handoff and the receipts, so write a handoff that stands on its own.



######## attended=true mode=auto runner=null
- opening line before Where: ["# norn brief — gh-1/02 · implement #1","","You do one step of a larger delivery and report how it ended, once; code decides what happens next.",""]
- order where<work: true
- contains 'Mode:' line: false
- contains 'Attended step' banner: false
- contains 'supervisor': false

## Where you run

- A person works with you in this session: ask them here, not with `norn ask`, and report `done` only once they agree the work is finished.
- Mode manual: the story asked for auto, but this machine has no runner, so nothing starts on its own: after your report, the next agent step waits for a person to start it.



######## attended=true mode=manual runner=herdr
- opening line before Where: ["# norn brief — gh-1/02 · implement #1","","You do one step of a larger delivery and report how it ended, once; code decides what happens next.",""]
- order where<work: true
- contains 'Mode:' line: false
- contains 'Attended step' banner: false
- contains 'supervisor': false

## Where you run

- A person works with you in this session: ask them here, not with `norn ask`, and report `done` only once they agree the work is finished.
- Mode manual: after your report, the next agent step waits for a person to start it.



######## attended=true mode=manual runner=headless
- opening line before Where: ["# norn brief — gh-1/02 · implement #1","","You do one step of a larger delivery and report how it ended, once; code decides what happens next.",""]
- order where<work: true
- contains 'Mode:' line: false
- contains 'Attended step' banner: false
- contains 'supervisor': false

## Where you run

- A person works with you in this session: ask them here, not with `norn ask`, and report `done` only once they agree the work is finished.
- Mode manual: after your report, the next agent step waits for a person to start it.



######## attended=true mode=manual runner=null
- opening line before Where: ["# norn brief — gh-1/02 · implement #1","","You do one step of a larger delivery and report how it ended, once; code decides what happens next.",""]
- order where<work: true
- contains 'Mode:' line: false
- contains 'Attended step' banner: false
- contains 'supervisor': false

## Where you run

- A person works with you in this session: ask them here, not with `norn ask`, and report `done` only once they agree the work is finished.
- Mode manual: after your report, the next agent step waits for a person to start it.

