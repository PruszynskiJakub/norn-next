# AC2 hands-on (throwaway repo, real quick workflow with sync)
```
{"ok":true,"unit":"gh-30","step":"explore","attempt":1,"run_id":"01M6BW8MF05FRPYGYC6JGXP84W","kind":"stuck","reason":"cannot reproduce","unblock_with":"norn run rerun gh-30","receipt":".agents/specs/g
"rule":"unit.parked.attended"
"rule":"receipts.apply"
"step":"explore"
"status":"stuck"
$ norn story edit gh-30 --workflow quick --force --at sync
{"unit":"gh-30","workflow":"quick","previous":"triage","started":true,"round":2,"to":"sync","receipt":{"kind":"round","receipt_id":"01M6BW8Q0Y7VQ4WYA5TWXJ06WQ","run_id":"01M6BW8MF05FRPYGYC6JGXP84W","step":"explore","attempt":1,"at":"2026-11-01T15:39:50.686Z","by":"human","who":"jakubpruszynski@mac","slice":null,"round":1,"workflow":"quick","workflow_hash":"33c188e38f2e16b24c5b6e4b6758dd4effd9a989c8719449374101ec0f90dacd","to":"sync","forced":true,"left_at":"explore"},"delivered":{"via":"local","claim":"mine","n":3,"file":".agents/specs/gh-30-stuck-one/runs/_story/rounds/01-triage/receipts/0003-round.json"},"next":"norn tick"}
exit 0
"rule":"unit.parked.attended"
"rule":"round.start"
01-triage
02-quick
"workflow":"quick"
"step":"sync"
"status":"ready"
"round":2
--- round 1:
"step":"$done"
"status":"done"
"step":"explore"
"ended":{"by":"person","at":"explore","receipt_id":"01M6BW8Q0Y7VQ4WYA5TWXJ06WQ"}
```
