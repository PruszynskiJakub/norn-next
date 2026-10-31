(cwd: clone C main checkout)
$ norn story close gh-7 --yes --json
{"story":"gh-7","dropped":true,"killed":[],"committed":["gh-7"],"pushed":["gh-7-add-login-form","gh-7/01-form"],"worktrees_removed":["/private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--10-story-checkout-handoff-close/777c9325-1c70-432f-af87-3006eb3ee62b/scratchpad/qa/C-worktrees/gh-7-add-login-form--01-form","/private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--10-story-checkout-handoff-close/777c9325-1c70-432f-af87-3006eb3ee62b/scratchpad/qa/C-worktrees/gh-7-add-login-form"],"branches_deleted":["gh-7/01-form","gh-7-add-login-form"],"leases_released":["slot-1.json","slot-2.json"],"claim_deleted":true,"record":"origin/gh-7-add-login-form"}
exit=0
$ git branch --list "gh-7*"
$ git ls-remote origin
5a46eca3b2d3ffafe74a10abc7ef18e50c1b32e2	HEAD
6e035679cbb486840710d8634362e15304d4dee6	refs/heads/gh-7-add-login-form
7245efa280a141474b75648fb2be6be750af7e2e	refs/heads/gh-7/01-form
5a46eca3b2d3ffafe74a10abc7ef18e50c1b32e2	refs/heads/main
$ story.md status on pushed story branch
status: dropped
$ gh calls made by close (issue/pr writes would show here)
(end of gh log)
