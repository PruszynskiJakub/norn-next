# QA gh-75/12 — story create
Full suite 1265 pass / 0 fail, typecheck green (suite.txt). Every CLI check ran the dev build (`bun packages/cli/src/main.ts`) in a throwaway repo under $TMPDIR, with a scripted `gh` and a recording `open` on PATH, runner null, `NORN_*` unset for the terminal checks.

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| AC1 (B18) | pass | AC1.txt | createIssue + newIssueUrl contract tests pass on FakeRemote, gh and glab over scripted CLIs |
| AC2 (B18) | pass | AC2-title.txt, AC2-body-file.txt | issue #101 labelled norn, norn:wf:fix, assigned qa-person; intake ran (issue list); prints gh-101; status: new / not_started / step null; --body-file body arrived intact |
| AC3 (B19) | pass | AC3.txt, AC3-tempfile.txt | real pty (expect): Title: prompt → $EDITOR → issue created with that body; blank title → exit 2, no remote call, no editor; editor temp dir removed |
| AC4 (B20) | pass | AC4.txt | --json (even under a pty) and no TTY → exit 2 title_required, do_instead "pass --title: …", nothing prompted, no gh calls |
| AC5 (B21) | pass | AC5.txt | --workflow nope → exit 3 unknown_workflow listing bug, fix, slice, spec, story; zero gh calls |
| AC6 (B22) | pass | AC6.txt | gh issue create failing → exit 1 remote_failed naming the gh error, do_instead norn doctor; no local change, no new story |
| AC7 (B23) | pass | AC7.txt | opener got https://github.com/acme/app/issues/new?labels=norn%2Cnorn%3Awf%3Aspec; only `repo view` called; nothing created |
| AC8 (B18, B23) | unverified | AC8.md | no writable GitHub test repo here; steps for a person inside |

Observations (not failures): an agent session (NORN_RUN set) under a TTY is refused as a script, which is D2/A6 as designed. A plain `--body`+`--body-file` clash prints "Usage error (usage)".
