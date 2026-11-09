| `git push` | deny | norn refused this call. Never `git push` (only norn pushes): a push outside norn is an effect with no receipt, and receipts come before effe |
| `git push origin HEAD` | deny | norn refused this call. Never `git push` (only norn pushes): a push outside norn is an effect with no receipt, and receipts come before effe |
| `FOO=1 BAR=2 git push` | deny | norn refused this call. Never `git push` (only norn pushes): a push outside norn is an effect with no receipt, and receipts come before effe |
| `git -C /tmp push` | deny | norn refused this call. Never `git push` (only norn pushes): a push outside norn is an effect with no receipt, and receipts come before effe |
| `git -c a.b=c push --force` | deny | norn refused this call. Never `git push` (only norn pushes): a push outside norn is an effect with no receipt, and receipts come before effe |
| `ls; git push` | deny | norn refused this call. Never `git push` (only norn pushes): a push outside norn is an effect with no receipt, and receipts come before effe |
| `bun test && git push` | deny | norn refused this call. Never `git push` (only norn pushes): a push outside norn is an effect with no receipt, and receipts come before effe |
| `false || git push` | deny | norn refused this call. Never `git push` (only norn pushes): a push outside norn is an effect with no receipt, and receipts come before effe |
| `echo hi | git push` | deny | norn refused this call. Never `git push` (only norn pushes): a push outside norn is an effect with no receipt, and receipts come before effe |
| `echo a\ngit push` | deny | norn refused this call. Never `git push` (only norn pushes): a push outside norn is an effect with no receipt, and receipts come before effe |
| `git switch main` | deny | norn refused this call. Never switch branches or worktrees: a switch leaves the unit's branch, where norn commits what is left at the report |
| `git switch -c new` | deny | norn refused this call. Never switch branches or worktrees: a switch leaves the unit's branch, where norn commits what is left at the report |
| `git checkout -b x` | deny | norn refused this call. Never switch branches or worktrees: a switch leaves the unit's branch, where norn commits what is left at the report |
| `git checkout -B x` | deny | norn refused this call. Never switch branches or worktrees: a switch leaves the unit's branch, where norn commits what is left at the report |
| `git checkout --orphan x` | deny | norn refused this call. Never switch branches or worktrees: a switch leaves the unit's branch, where norn commits what is left at the report |
| `git checkout --detach` | deny | norn refused this call. Never switch branches or worktrees: a switch leaves the unit's branch, where norn commits what is left at the report |
| `git checkout -` | deny | norn refused this call. Never switch branches or worktrees: a switch leaves the unit's branch, where norn commits what is left at the report |
| `gh pr checkout 3` | deny | norn refused this call. Never switch branches or worktrees: a switch leaves the unit's branch, where norn commits what is left at the report |
| `glab mr checkout 3` | deny | norn refused this call. Never switch branches or worktrees: a switch leaves the unit's branch, where norn commits what is left at the report |
| `git worktree add ../x` | deny | norn refused this call. Never switch branches or worktrees: a switch leaves the unit's branch, where norn commits what is left at the report |
| `git worktree move a b` | deny | norn refused this call. Never switch branches or worktrees: a switch leaves the unit's branch, where norn commits what is left at the report |
| `git worktree remove a` | deny | norn refused this call. Never switch branches or worktrees: a switch leaves the unit's branch, where norn commits what is left at the report |
| `git checkout main` | deny | norn refused this call. Never switch branches or worktrees: a switch leaves the unit's branch, where norn commits what is left at the report |
| `git checkout README.md` | allow |  |
| `git checkout -- main` | allow |  |
| `git checkout nosuchthing` | allow |  |
| `gh pr create --fill` | deny | norn refused this call. Never run a `gh` or `glab` command that changes the remote (creating, editing, commenting, labelling, closing, mergi |
| `gh pr edit 3 --title x` | deny | norn refused this call. Never run a `gh` or `glab` command that changes the remote (creating, editing, commenting, labelling, closing, mergi |
| `gh pr comment 3 -b x` | deny | norn refused this call. Never run a `gh` or `glab` command that changes the remote (creating, editing, commenting, labelling, closing, mergi |
| `gh pr review 3 --approve` | deny | norn refused this call. Never run a `gh` or `glab` command that changes the remote (creating, editing, commenting, labelling, closing, mergi |
| `gh pr ready 3` | deny | norn refused this call. Never run a `gh` or `glab` command that changes the remote (creating, editing, commenting, labelling, closing, mergi |
| `gh pr merge 3` | deny | norn refused this call. Never run a `gh` or `glab` command that changes the remote (creating, editing, commenting, labelling, closing, mergi |
| `gh pr close 3` | deny | norn refused this call. Never run a `gh` or `glab` command that changes the remote (creating, editing, commenting, labelling, closing, mergi |
| `gh pr reopen 3` | deny | norn refused this call. Never run a `gh` or `glab` command that changes the remote (creating, editing, commenting, labelling, closing, mergi |
| `gh issue create -t x` | deny | norn refused this call. Never run a `gh` or `glab` command that changes the remote (creating, editing, commenting, labelling, closing, mergi |
| `gh issue edit 3` | deny | norn refused this call. Never run a `gh` or `glab` command that changes the remote (creating, editing, commenting, labelling, closing, mergi |
| `gh issue comment 3 -b x` | deny | norn refused this call. Never run a `gh` or `glab` command that changes the remote (creating, editing, commenting, labelling, closing, mergi |
| `gh issue close 3` | deny | norn refused this call. Never run a `gh` or `glab` command that changes the remote (creating, editing, commenting, labelling, closing, mergi |
| `gh issue reopen 3` | deny | norn refused this call. Never run a `gh` or `glab` command that changes the remote (creating, editing, commenting, labelling, closing, mergi |
| `gh label create x` | deny | norn refused this call. Never run a `gh` or `glab` command that changes the remote (creating, editing, commenting, labelling, closing, mergi |
| `gh release create v1` | deny | norn refused this call. Never run a `gh` or `glab` command that changes the remote (creating, editing, commenting, labelling, closing, mergi |
| `gh release delete v1` | deny | norn refused this call. Never run a `gh` or `glab` command that changes the remote (creating, editing, commenting, labelling, closing, mergi |
| `gh repo edit --description x` | deny | norn refused this call. Never run a `gh` or `glab` command that changes the remote (creating, editing, commenting, labelling, closing, mergi |
| `gh repo delete x` | deny | norn refused this call. Never run a `gh` or `glab` command that changes the remote (creating, editing, commenting, labelling, closing, mergi |
| `glab mr create` | deny | norn refused this call. Never run a `gh` or `glab` command that changes the remote (creating, editing, commenting, labelling, closing, mergi |
| `glab mr merge 3` | deny | norn refused this call. Never run a `gh` or `glab` command that changes the remote (creating, editing, commenting, labelling, closing, mergi |
| `glab issue close 3` | deny | norn refused this call. Never run a `gh` or `glab` command that changes the remote (creating, editing, commenting, labelling, closing, mergi |
| `glab mr note 3 -m x` | deny | norn refused this call. Never run a `gh` or `glab` command that changes the remote (creating, editing, commenting, labelling, closing, mergi |
| `gh api -X POST repos/a/b/issues` | deny | norn refused this call. Never run a `gh` or `glab` command that changes the remote (creating, editing, commenting, labelling, closing, mergi |
| `gh api --method PATCH repos/a/b` | deny | norn refused this call. Never run a `gh` or `glab` command that changes the remote (creating, editing, commenting, labelling, closing, mergi |
| `gh api repos/a/b/issues -f title=x` | deny | norn refused this call. Never run a `gh` or `glab` command that changes the remote (creating, editing, commenting, labelling, closing, mergi |
| `gh api repos/a/b -F x=1` | deny | norn refused this call. Never run a `gh` or `glab` command that changes the remote (creating, editing, commenting, labelling, closing, mergi |
| `gh api repos/a/b --field x=1` | deny | norn refused this call. Never run a `gh` or `glab` command that changes the remote (creating, editing, commenting, labelling, closing, mergi |
| `gh api repos/a/b --raw-field x=1` | deny | norn refused this call. Never run a `gh` or `glab` command that changes the remote (creating, editing, commenting, labelling, closing, mergi |
| `gh api repos/a/b --input f.json` | deny | norn refused this call. Never run a `gh` or `glab` command that changes the remote (creating, editing, commenting, labelling, closing, mergi |
| `gh pr view 3` | allow |  |
| `gh pr list` | allow |  |
| `gh pr status` | allow |  |
| `gh pr diff 3` | allow |  |
| `gh pr checks 3` | allow |  |
| `gh api repos/a/b` | allow |  |
| `gh api -X GET repos/a/b` | allow |  |
| `glab mr view 3` | allow |  |
| `gh issue list` | allow |  |
| `echo 'git push'` | allow |  |
| `echo "git push"` | allow |  |
| `echo $(( ` | allow |  |
| `echo 'unterminated` | allow |  |
| `bun run test` | allow |  |
