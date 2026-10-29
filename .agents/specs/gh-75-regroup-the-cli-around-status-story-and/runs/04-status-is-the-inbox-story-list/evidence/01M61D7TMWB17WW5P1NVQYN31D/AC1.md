# AC1 (B9)
- Tests: human.test.ts "parked ask shows in the inbox…" and "story list and status show the gate…" (Approve + Answer groups via `norn status`), status.test.ts; 33/33 pass in status/segment/human, full suite 1249 pass.
- By hand (scratch repo, no stories): `status` prints "Inbox empty — no stories yet. Label an issue `norn`…" (AC7-status1.stdout); with a story and nothing to do: "Inbox empty — nothing needs you."; identical to released `norn inbox` 0.10.0 on the same repo (see AC2.md).
