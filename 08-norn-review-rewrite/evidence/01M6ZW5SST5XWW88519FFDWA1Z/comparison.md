# norn-review before/after on two past diffs

Each version reviewed a `git archive` copy of the head, blind to the delivery record (one subagent per run, same prompt apart from the skill path). Outputs: `<case>-<old|new>-findings.json`, `<case>-<old|new>-table.md`; the skill texts are in `old-skill/` and `new-skill/`.

## gh-249: open story PR takes the issue title (head eb979aa, base 7fd61b2)

Original review #1: changes requested; blocking "GitLab draft MRs are retitled at the first sync, which removes their draft status"; minor "a failed retitle overwrites the story unit's act failure". Rework fixed both.

| | old skill | new skill |
| --- | --- | --- |
| verdict | changes requested | changes requested |
| GitLab draft retitle (original blocking) | not raised | not raised |
| failed retitle overwrites act failure (original minor, fixed in rework) | blocking | blocking |
| other | blocking: no test proves the ready gate's title check is gone; minor: retitle only checked against scripted gh/glab | none |

## gh-273: appendProgress at any heading level (head 4b9567c, base 6db7dbd)

Original review: approve, one minor (case-sensitive Progress match).

| | old skill | new skill |
| --- | --- | --- |
| verdict | changes requested | changes requested |
| `#` comment inside a fenced code block in Progress ends the section | blocking | blocking |
| case-sensitive Progress match (original minor) | not raised | minor |
| other | blocking: comments carry the issue number and history; minor: levels 5-6 untested | none |

## Reading

- Against AC4 as written, the new skill does **not** pass: it misses the original blocking defect on gh-249, and raises a blocking finding on gh-273.
- The old skill, re-run today, does exactly the same on both counts. On these two diffs the rewrite loses nothing against the old skill: every blocking finding the new one raised, the old one raised too. The old one raised two more blocking findings (an untested Wanted item on gh-249; issue numbers in comments on gh-273), and the new one re-found gh-273's original minor finding.
- gh-273's fenced-code finding was not in the original review; whether it is a real defect is for the person (the reviewer wrote a probe, `probe/fence.ts`).
- A run is one sample of a non-deterministic reviewer; the original gh-249 finding depended on GitLab knowledge neither re-run brought in.
- The old skill's extra gh-273 blocking finding (issue numbers in comments) does not hold at that head: its AGENTS.md (line 3) told agents to cite rule ids in code comments, and the new run says so explicitly. The new skill avoided a false blocking finding there.
