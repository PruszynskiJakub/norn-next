---
name: norn-qa-person
description: Walk a person through QA of a slice or story from the agent's evidence pack and their remarks, recording their verdict with a repro for every failure. Use when a person QAs a change with an agent at their side; QA on your own is norn-qa.
---

# QA with a person

The person decides; you run things and record. Without this, an agent copies its own or the earlier agent's passes into the report: a `pass` here is only what the person gave.

1. **Find the agent's evidence pack.** Your instructions say where it is: each unit's latest criteria report and its evidence folder (`report.md` and one file per criterion). Note what it checked, what it saw, and what it left for a person (`person` and `unverified` verdicts, each with its `how`). No pack: every criterion is the person's to check.
2. **Set up for the person** on the branch in this worktree, as it is, with the ports and environment configured for it: run the test suite, start the app. If the branch head moved since the pack was made, its passes judged older code: say so, and treat what the change touched as unchecked.
3. **Walk the person through what is left for them**, one criterion at a time, with what the agent prepared. Then ask which of the pack's passes they want to question; they may fail one. The ones they accept as the agent observed them are their `pass`, with the agent's evidence.
4. **Remarks of their own.** If the person tried the app on their own, take their list of remarks and tie each to a criterion (for a story: a user story); a remark on a criterion fails it. For a remark outside the criteria, the person chooses:
   - **follow up** (the default, so QA does not grow the slice): a new story the person files;
   - **pull it in**: it fails this slice or story, like a criterion;
   - **drop it**: noted only.
5. **For each failure, capture a repro**: the one command or the shortest sequence of user actions that shows it, with expected and observed results, as tight as you can: implementation turns it into a red test. Save what the person shows you (screenshots, logs) as evidence files named after the criterion (`AC2.png`).
6. **Record the verdicts** in a criteria report (`criteria.json`) next to the evidence, outside the repository, one entry per criterion, the same shape `norn-qa` writes. A person's `pass` still needs `evidence`: a file, or what they saw in their words. Every `fail` gets a `findings.json` entry (`severity: blocking`, `criterion`, `title`, `repro`).

   ```json
   [
     { "id": "AC1", "verdict": "pass", "evidence": "person: dialog matches Figma frame 12" },
     { "id": "AC2", "verdict": "fail", "repro": "Add 'buy milk p1' on /today. Expected a red flag; actual none.", "evidence": "AC2.png" }
   ]
   ```

7. **Report once the person agrees** with the report: pass the criteria file, the findings file and the evidence folder to the report command your instructions name, matching the worst verdict.

**Redact every secret** the person shows you: write `<REDACTED>` in its place, and crop or blur it in screenshots. Evidence is pushed with the story's record to the shared remote.

Done when every criterion has the person's verdict, every failure has a repro and a finding, and every remark is tied to a criterion, a follow-up, or dropped. Hand back the person's verdict (pass, or fail with each failing criterion's repro) and the follow-ups for the person to file.
