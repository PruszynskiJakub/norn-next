---
name: norn-qa-person
description: Walk a person through QA of a change, starting from an agent's evidence pack and from the person's own remarks, and record their verdict with a repro for every failure. Use when a person QAs a slice or a story with an agent at their side.
---

# QA with a person

The person decides; you run things and record. An agent has QA'd before you: its evidence pack (the criteria report, `report.md` and the evidence files) is where you start.

1. **Read the agent's evidence pack**: what it checked, what it saw, and what it left for a person (`person` and `unverified` verdicts, each with how to check it).
2. **Run the full test suite and the app** from the branch in this worktree, as it is, on this machine.
3. **Walk the person through what is left for them**, one criterion at a time, with what the agent prepared. Then through anything in the pack they want to question; they may fail a criterion the agent passed.
4. **Remarks of their own.** If the person tried the app on their own, take their list of remarks. Tie each to a criterion (for a story: a Behaviour item); a remark on a criterion fails it. For a remark outside the criteria, the person chooses:
   - **follow up** (the default, so QA does not grow the slice): it becomes a new story the person files;
   - **pull it in**: it fails this slice or story, like a criterion;
   - **drop it**: noted only.
5. **For each failure, capture a repro**: the one command or the shortest sequence of user actions that shows it, with expected and observed results. Make it as tight as you can: implementation turns it into a red test. Save what the person shows you (screenshots, logs) as evidence files named after the criterion.
6. **Record the verdicts** in the same criteria report shape the agent used (`criteria.json`, next to the evidence): the person's `pass` or `fail` for every criterion, with `evidence` or `repro`, and a `findings.json` entry for every failure. Never record a `pass` the person did not give.

**Redact every secret** in what you record and in every evidence file: write `<REDACTED>` in its place, and crop or blur it in screenshots.

Done when every criterion has the person's verdict, every failure has a repro, and every remark is tied to a criterion, a follow-up, or dropped. What you hand back is the person's verdict — pass, or fail with each failing criterion's repro, expected and observed results — plus the follow-ups for the person to file.
