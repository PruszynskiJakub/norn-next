## AC3/AC2 manual: torn chunk line in the live repo, then a new tick (fresh process, chunks file size changed)
   15997 .agents/norn/trace/2026-10-30.chunks.jsonl
exit 0
   15997 .agents/norn/trace/2026-10-30.chunks.jsonl
--- chunk lines (h prefix)
{"h":"7134d4caf1ae53b827b0677febe0466ff976fb1b7eb1f31d8a137be72f8b1aa8","v":{"ho
{"h":"6280547437e0f5512a54f91470e18e18b8e3fa55cda43b426d7ca56fca02e467","v":"# B
{"h":"a3bfe2332408c5d5f384eec80f74f16f788a5a1a544f6ad1b103d19186adeffd","v":"# S
{"h":"d37209d08e1c367d3919dce7fa17824f19e014fea7bc4a9437c7d6f6752cd32b","v":"# S
{"h":"6b044121279ed3d83c4e5b9d2328df85c85fe939b57ba8436e40f29d1147d642","v":{"ag
{"h":"abc","v":{"tor01M671TKGZRNCA522AQBPXEJMH schema-valid: true read: ok facts.machine.holder=jakubpruszynski@MacBook-Pro-Jakub-2 workflows=bug,slice,story
01M671TV6P6CCHBH7FQMYT6K8P schema-valid: true read: ok facts.machine.holder=jakubpruszynski@MacBook-Pro-Jakub-2 workflows=bug,slice,story
01M671VZXX9RYN0VDVC9XQ206T schema-valid: true read: ok facts.machine.holder=jakubpruszynski@MacBook-Pro-Jakub-2 workflows=bug,slice,story
## AC3 cont.: change a workflow source so a new chunk must be written after the torn line
exit 0
   18768 .agents/norn/trace/2026-10-30.chunks.jsonl
{"h":"7134d4caf1ae53b827b0677febe0466ff976fb1b7eb1f31d8a137be72f8b1aa8","v":{"ho
{"h":"6280547437e0f5512a54f91470e18e18b8e3fa55cda43b426d7ca56fca02e467","v":"# B
{"h":"a3bfe2332408c5d5f384eec80f74f16f788a5a1a544f6ad1b103d19186adeffd","v":"# S
{"h":"d37209d08e1c367d3919dce7fa17824f19e014fea7bc4a9437c7d6f6752cd32b","v":"# S
{"h":"6b044121279ed3d83c4e5b9d2328df85c85fe939b57ba8436e40f29d1147d642","v":{"ag
{"h":"abc","v":{"tor
{"h":"0562d1a22d6fc279e7a0950d3c3bcc68e6842a1fb04d4c426871d83fee338734","v":"# B
01M671TKGZRNCA522AQBPXEJMH schema-valid: true read: ok facts.machine.holder=jakubpruszynski@MacBook-Pro-Jakub-2 workflows=bug,slice,story
01M671TV6P6CCHBH7FQMYT6K8P schema-valid: true read: ok facts.machine.holder=jakubpruszynski@MacBook-Pro-Jakub-2 workflows=bug,slice,story
01M671VZXX9RYN0VDVC9XQ206T schema-valid: true read: ok facts.machine.holder=jakubpruszynski@MacBook-Pro-Jakub-2 workflows=bug,slice,story
01M671W705E4YNT97887S1M3SQ schema-valid: true read: ok facts.machine.holder=jakubpruszynski@MacBook-Pro-Jakub-2 workflows=bug,slice,story
