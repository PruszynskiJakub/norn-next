## Summary

The cockpit's Backlog tab now lists open `norn` issues that are not assigned to you, showing number, title and labels. `t take` on one of them assigns it to you, and the next sync takes it in (GR1, SPEC-cockpit CP2/CP4). Until now the tab was always empty, because intake starts every story at once (GR2).

```text
norn status --watch                      # backlog read on start, every 5 min, on `r`, after a take
  readBacklog
    remote.whoami
    remote.listLabelledIssues({label})   # new RemotePort read: gh/glab `issue list --label`
  cockpitModel(view, { backlog })        # stays pure (CP1)
    rows: items, stories, issueRows      # new: kind "issue", tab backlog — open, not mine, not taken in
      actions: take → `norn story take <key>`, issue → link

norn story take <story>                  # new verb (GR1)
  refuse: taken in / no issue / closed / no label
  remote.assignIssue(n, whoami)          # new RemotePort effect: gh `--add-assignee`, glab `--assignee +login`
  (writes nothing locally; the next `norn sync` takes it in)
```

The TUI adds an ISSUES section under Backlog. Each issue row reads `gh-12  Sort the list  norn, bug · someone-else` (or `· unassigned`). The tab also gets an issue preview, a filter that matches labels, help for `t` and new empty text: "no story waits to start, no open issue waits to be taken". The PRD (GR1, command table) and SPEC-cockpit (CP1–CP4, CP6) are updated to match.

## Evidence

No QA step ran in this `quick` round. The evidence below is the tests on the branch, all new with this change. The unit tier, the type check and the touched integration files pass (implement#1, review#1). The workflow's `test` check (unit tier, integration tier and type check) passed (receipt 0007).

- **Backlog lists open `norn` issues not assigned to me, with number, title, labels**
  **Before:** the Backlog tab listed only taken-in, not-started stories, so it was always empty.
  **After:** `packages/view/test/unit/cockpit.test.ts`: cockpitModel turns the backlog issues into `kind: "issue"` rows in `backlog`, leaving out issues that are closed, assigned to me or taken in, with actions `[take, issue]`. `packages/cli/test/unit/cockpit-tui.test.ts`: the frame shows `ISSUES 2`, then `gh-12  Sort the list  norn, bug · someone-else` and `gh-31 … · unassigned` sorted after the stories. The preview says "not taken in: t assigns it to you" with the issue URL. Filtering on `bug` matches labels.
- **`t take` assigns the issue to me**
  **Before:** did not exist (`t take` meant `story checkout` only).
  **After:** `packages/cli/test/integration/story-take.test.ts`: `norn story take gh-12` records `assign 12 tester` on the remote, and the issue's assignees become `["tester"]`. An issue assigned to someone else gets me added as well. A closed, unlabelled, missing or taken-in issue is refused (exit 3) and nothing is assigned. `status-watch.test.ts`: pressing `t` on gh-7 shows `ok: norn story take gh-7`, the count goes from `ISSUES 2` to `ISSUES 1`, and the backlog is read twice (on start and after the take), not on every frame.
- **The next sync takes it in**
  **Before:** an unassigned issue was never taken in.
  **After:** `story-take.test.ts`: `story take` itself lists nothing. After it, `norn sync` exits 0 and the stories include `gh-12`.
- **The remote ports** (`listLabelledIssues`, `assignIssue`)
  **After:** two new contract tests in `packages/adapters/test/contract/remote.ts` run against gh, glab (both over scripted CLIs) and FakeRemote. The labelled list returns my issues, others' issues and unassigned ones (`[1, 4, 6]`), and an unknown label returns `[]`. Assigning adds to the existing assignees and does not replace them.
- **Not shown:** the real `gh`/`glab` CLIs against a live remote. They are covered only by scripted CLIs and argv unit tests. To check by hand, run `norn status --watch` in a repo that has an unassigned `norn` issue and press `t` on it.

## Merge danger

**Door:** two-way: a revert removes the verb, the port methods and the rows, and leaves nothing behind. The only remote effect is adding an assignee, which a person can undo on the issue.

**Blast radius:** cockpit users: the `status --watch --json` model (CP5) changes shape. `preview.report` can now be `null` (on issue rows), and `kind` can be `"issue"`, so a front end that reads `preview.report` without checking for null breaks on the Backlog tab. Every `RemotePort` implementation must add `listLabelledIssues` and `assignIssue`, which is a breaking change for any third-party remote adapter (X2). Smaller points from review:
- `--json` drops a failed backlog read silently. The model then has no issue rows and nothing that says the read failed (the TUI does show the failure in its footer).
- glab lists at most 100 issues, with no paging.
- Every take re-reads the backlog, including a take on a story row, which costs one extra read.
