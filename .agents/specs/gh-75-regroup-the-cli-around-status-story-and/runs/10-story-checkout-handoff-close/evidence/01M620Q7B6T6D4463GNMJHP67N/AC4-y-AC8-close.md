--- AC4 y + AC8 close (cwd: B slice worktree, no story argument)
$ script -q /dev/null norn story close   (typed: y)
Close gh-7? Worktrees for 2 units will be removed [y/N] y
{"story":"gh-7","dropped":true,"killed":[],"committed":["gh-7/01","gh-7"],"pushed":["gh-7-add-login-form","gh-7/01-form"],"worktrees_removed":["/private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--10-story-checkout-handoff-close/777c9325-1c70-432f-af87-3006eb3ee62b/scratchpad/qa/B-worktrees/gh-7-add-login-form--01-form","/private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--10-story-checkout-handoff-close/777c9325-1c70-432f-af87-3006eb3ee62b/scratchpad/qa/B-worktrees/gh-7-add-login-form"],"branches_deleted":["gh-7/01-form","gh-7-add-login-form"],"leases_released":["slot-1.json","slot-2.json"],"claim_deleted":true,"record":"origin/gh-7-add-login-form"}
exit=0
$ ls B-worktrees
$ git worktree list
/private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--10-story-checkout-handoff-close/777c9325-1c70-432f-af87-3006eb3ee62b/scratchpad/qa/B  2ce5cb2 [main]
$ git branch --list "gh-7*"
$ git ls-remote origin
2ce5cb25362a7eb39887a47a0bc629a4a3cb235a	HEAD
842afe55298ccb9dffd92c72af69f9bbfb11b723	refs/heads/gh-7-add-login-form
662e01b0c73f1e2dd1ed19a0a826e0b92b3bdf0c	refs/heads/gh-7/01-form
2ce5cb25362a7eb39887a47a0bc629a4a3cb235a	refs/heads/main
$ git show origin/gh-7-add-login-form:.../story.md | grep status
status: dropped
$ git show origin/gh-7/01-form:wip.txt
unfinished
$ ls home-B leases
/private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--10-story-checkout-handoff-close/777c9325-1c70-432f-af87-3006eb3ee62b/scratchpad/qa/home-B/leases
$ gh calls during close
