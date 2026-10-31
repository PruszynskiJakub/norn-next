$ norn init
norn init in /private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-LDKlbv/repo

  config          .agents/norn/config.yaml created
  workflows       created bug.yaml, slice.yaml, story.yaml
  skills          .agents/skills: updated norn, norn-clarify, norn-codebase-design, norn-diagnose, norn-implement, norn-interview, norn-merge, norn-plan, norn-pr, norn-prototype, norn-qa, norn-qa-person, norn-refine, norn-retro, norn-review, norn-slice, norn-tdd (17 skills)
                  claude → .claude/skills: linked norn, norn-clarify, norn-codebase-design, norn-diagnose, norn-implement, norn-interview, norn-merge, norn-plan, norn-pr, norn-prototype, norn-qa, norn-qa-person, norn-refine, norn-retro, norn-review, norn-slice, norn-tdd
  hooks           claude: installed in .claude/settings.json
  hook command    norn hook
  .gitignore      added .agents/norn/trace/, .env.norn, .norn-unit
  .gitattributes  added .agents/specs/*/runs/** linguist-generated=true gitlab-generated=true
  test command    bun test (not detected: the template's default)
  remote          origin → /private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-LDKlbv/remote.git

Next steps
  1. Set your test command: the `test` steps in .agents/norn/workflows/ run `bun test` — change `run:` there.
  2. Commit and push the setup: `git add .agents .claude .gitignore .gitattributes && git commit -m "Set up norn" && git push`.
  3. Check this machine: `norn doctor`.
  4. Make a first story: an issue labelled `norn` and assigned to you, e.g. `gh label create norn` (once), then `gh issue create --label norn --assignee @me --title "…"`.
  5. Pick it up: `norn sync`, then `norn status` shows what needs you and the command for each item; `norn watch` keeps norn working.
[exit 0]

