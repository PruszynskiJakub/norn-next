gh-1 park: {"kind":"attended","reason":"attended step work: work with the agent in the worktree","since":"2099-01-15T10:00:20.000Z"}
$ norn status   (runner that opens terminals)
Your turn (1) · work only you can do
  gh-1       work: attended step — work with the agent · 0s
      by hand: cd /private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-QpqFxs/repo-worktrees/gh-1-pay-invoices && claude 'Use the norn skill, then run `norn brief`.'
      $ norn story start gh-1
[exit 0]
$ norn story start gh-1   (runner can open a pane: records openForPerson)
{"unit":"gh-1","step":"work","worktree":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-QpqFxs/repo-worktrees/gh-1-pay-invoices","command":"cd /private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-QpqFxs/repo-worktrees/gh-1-pay-invoices && claude 'Use the norn skill, then run `norn brief`.'","opened":true,"runner":"fake","pane_id":"p-9"}
[exit 0]
panes opened so far: [{"cwd":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-QpqFxs/repo-worktrees/gh-1-pay-invoices","title":"gh-1 work","command":"cd /private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-QpqFxs/repo-worktrees/gh-1-pay-invoices && claude 'Use the norn skill, then run `norn brief`.'","env":"<REDACTED: process environment>"}]
$ norn story start gh-1 --print   (runner can open a pane: records openForPerson)
{"unit":"gh-1","step":"work","worktree":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-QpqFxs/repo-worktrees/gh-1-pay-invoices","command":"cd /private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-QpqFxs/repo-worktrees/gh-1-pay-invoices && claude 'Use the norn skill, then run `norn brief`.'","opened":false}
[exit 0]
panes opened so far: [{"cwd":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-QpqFxs/repo-worktrees/gh-1-pay-invoices","title":"gh-1 work","command":"cd /private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-QpqFxs/repo-worktrees/gh-1-pay-invoices && claude 'Use the norn skill, then run `norn brief`.'","env":"<REDACTED: process environment>"}]
