before: 35194429d61f474e452f92de8fad13a408f08f92 c056802d6e33564dddee8ed168864ecc0da424f8 
== no TTY (stdin /dev/null, stdout piped)
**Usage error (file_required):** which config file? (no terminal to ask in)

Do instead: pass --user or --repo
[exit 2]
== --json at a pty
spawn /private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--13-config-list-get-set-unset/d994b8ef-932a-462d-adef-2c45a5be9f60/scratchpad/qa/n config set default_mode auto --json
{"error":"which config file? (no terminal to ask in)","do_instead":"pass --user or --repo","code":"file_required"}
[exit 2]
== agent session (NORN_RUN=x) at a pty
spawn env -u NORN_HOME -u NORN_STORY -u NORN_SLICE NORN_RUN=x NORN_HOME_DIR=/private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--13-config-list-get-set-unset/d994b8ef-932a-462d-adef-2c45a5be9f60/scratchpad/qa/home bun /Users/jakubpruszynski/Projects/norn-worktrees/gh-75-regroup-the-cli-around-status-story-and--13-config-list-get-set-unset/packages/cli/src/main.ts config set default_mode auto
**Usage error (file_required):** which config file? (no terminal to ask in)

Do instead: pass --user or --repo
[exit 2]
== unset, no TTY --json
$ norn config unset default_mode --json
{"error":"which config file? (no terminal to ask in)","do_instead":"pass --user or --repo","code":"file_required"}
[exit 2]
== both flags
$ norn config set default_mode auto --user --repo --json
{"error":"--user and --repo together: pick one file","do_instead":"pass --user or --repo","code":"usage"}
[exit 2]
after: 35194429d61f474e452f92de8fad13a408f08f92 c056802d6e33564dddee8ed168864ecc0da424f8 
