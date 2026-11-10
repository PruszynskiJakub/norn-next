$ norn sync --json
{"tick_id":"01M72F9D957949XJT414EWX9Q2","at":"2026-11-10T10:15:33.925Z","duration_ms":693,"sync":{"ran":true,"ok":true},"decisions":[{"unit":"gh-1","rule":"remote.intake","kind":"intake_story","ok":true,"story":"gh-1"}],"notified":[],"trace":"2026-11-10.jsonl","failed":0,"slowest":{"phase":"act intake_story gh-1","ms":226},"follow_up":true,"intake":[{"rule":"remote.intake","ok":true}]}

exit=0  repo+machine-dir changed: YES

$ norn story start gh-1 --json
{"error":"gh-1 has not started yet","do_instead":"norn tick (or keep norn watch running), then norn story start gh-1 again","code":"not_started"}

exit=3  repo+machine-dir changed: YES

$ norn tick --json
{"tick_id":"01M72F9EVDY0NK0WKA88Z6GTZR","at":"2026-11-10T10:15:35.533Z","duration_ms":371,"sync":{"ran":false,"ok":true},"decisions":[{"unit":"gh-1","rule":"claim.acquire.intake","kind":"claim","ok":true}],"notified":[],"trace":"2026-11-10.jsonl","failed":0,"slowest":{"phase":"act claim gh-1","ms":128},"follow_up":true}

exit=0  repo+machine-dir changed: no

+ gh-1-demo-story
* main
  remotes/origin/main
