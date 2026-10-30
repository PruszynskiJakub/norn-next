# QA gh-75 qa#3 on HEAD

Evidence root: /var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa75c
- ev/: the branch's real CLI (`bun packages/cli/src/main.ts`, HERDR_*/NORN_* unset) in a throwaway repo with a local bare remote (/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa75c/r); released 0.11.1 run side by side for comparisons.
- e1/, e3/, e69/, ec/: drivers (/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa75c/qa.ts, qa3.ts, b69.ts, qa-cockpit.ts, qa-start.ts, qa-team.ts, qa-view.ts) running runCli against the integration harness (real git, fake remote/runner/clock/terminal).
- Full suite: /var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa75c/suite.txt.

63 pass · 1 person (B19) · 7 unverified (B12, B29, B46, B47 need herdr; B17 browser; B18 remote; B23 browser+remote) · 0 fail.

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| B1 | pass | ev/B1.md |  |
| B2 | pass | ev/B2.md |  |
| B3 | pass | ev/B3.md |  |
| B4 | pass | ev/B4.md |  |
| B5 | pass | ev/B5.md |  |
| B6 | pass | e1/B6.md, ev/B61.md |  |
| B7 | pass | ev/B7.md, e1/B9.md, e1/B51.md, e1/B50.md, ev/B7-doctor.md |  |
| B8 | pass | ev/B8-B71-lint.txt |  |
| B9 | pass | e1/B9.md, ev/B9-B10-released.md |  |
| B10 | pass | e1/B10.md, ev/B9-B10-released.md |  |
| B11 | pass | ec/B11-harness.md, ev/B11.typescript, ev/B11-esc.typescript |  |
| B12 | unverified | ev/B12.md | this session lacks herdr (the step's capabilities); only the outside-Herdr refusal was observed: exit 3 not_in_herdr, do_instead `norn status --watch` |
| B13 | pass | ev/B13-fresh.md, ev/B13.md | no notice under --json on a first run; stdout unaffected |
| B14 | pass | ev/B14.md |  |
| B15 | pass | e1/B15.md, ev/B70.md |  |
| B16 | pass | e1/B16.md, ec/B16-pr.md, e3/B55.md |  |
| B17 | unverified |  | this session lacks a browser |
| B18 | unverified | e1/B18-harness.md | this session lacks the real remote; observed only against the harness's fake remote (issue #81 created with labels norn + norn:wf:gated, assignee tester, taken in) |
| B19 | person | ev/B19-empty-title.typescript, e1/B19-harness.md |  |
| B20 | pass | ev/B20.md |  |
| B21 | pass | e1/B21-harness.md |  |
| B22 | pass | e1/B22-harness.md |  |
| B23 | unverified |  | this session lacks a browser and the real remote |
| B24 | pass | e1/B24.md |  |
| B25 | pass | e1/B58.md, e1/B25.md |  |
| B26 | pass | e1/B26.md, e1/B56.md |  |
| B27 | pass | e3/B27.md, e1/B27.md |  |
| B28 | pass | e3/B28.md, ec/B28-open.md | Herdr tab path observed through a runner that can open terminals (fake) |
| B29 | unverified |  | this session lacks herdr |
| B30 | pass | e1/B30.md |  |
| B31 | pass | e1/B31.md |  |
| B32 | pass | e1/B32.md |  |
| B33 | pass | ec/B33-cross.md, e1/B33.md |  |
| B34 | pass | ec/B34-cross.md, e3/B55.md |  |
| B35 | pass | e1/B35.md |  |
| B36 | pass | e1/B36.md | prompt says 'Worktrees for 1 units' (plural with 1) |
| B37 | pass | e1/B37.md |  |
| B38 | pass | e1/B38.md |  |
| B39 | pass | e1/B39.md |  |
| B40 | pass | e1/B40.md, ec/B40-gate.md |  |
| B41 | pass | e1/B41.md |  |
| B42 | pass | e1/B42.md |  |
| B43 | pass | e1/B43.md, e3/B27.md |  |
| B44 | pass | e1/B44.md |  |
| B45 | pass | e1/B45.md, e3/B45.md |  |
| B46 | unverified |  | this session lacks herdr |
| B47 | unverified |  | this session lacks herdr |
| B48 | pass | e1/B48.md |  |
| B49 | pass | e1/B49.md |  |
| B50 | pass | e1/B50.md |  |
| B51 | pass | e1/B51.md |  |
| B52 | pass | e1/B52.md, e1/B48.md | headless fake runner; under Herdr cancel closes the pane (ruling gh-75/09) |
| B53 | pass | e1/B53.md |  |
| B54 | pass | e1/B54.md |  |
| B55 | pass | e3/B55.md |  |
| B56 | pass | e1/B56.md |  |
| B57 | pass | e1/B57.md |  |
| B58 | pass | e1/B58.md |  |
| B59 | pass | e1/B59.md |  |
| B60 | pass | e1/B60.md, ev/B20.md |  |
| B61 | pass | ev/B61.md |  |
| B62 | pass | ev/B62.md |  |
| B63 | pass | ev/B63.md | setting agents.claude.model in the repo file writes the whole agents.claude entry (adapter, args) |
| B64 | pass | ev/B64.typescript |  |
| B65 | pass | ev/B65.md |  |
| B66 | pass | ev/B66.md |  |
| B67 | pass | ev/B67.md |  |
| B68 | pass | ev/B68.md |  |
| B69 | pass | e69/B69.md, ev/B69-usage.md |  |
| B70 | pass | ev/B70.md, ev/B70-schema.md | mid-workflow continuation rests on unchanged schemas (comments only) and the pinned golden/transcript suites |
| B71 | pass | ev/B8-B71-lint.txt |  |
