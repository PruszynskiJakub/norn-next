(repo: the commented config file)
before: fcb816cc7aeac1040e4d7ede2e8b5d1d149f5b7d c056802d6e33564dddee8ed168864ecc0da424f8 
$ norn config set slots.max lots --repo
**Refused (invalid_value):** repo: /slots/max must be integer

Do instead: norn config list
[exit 3]
$ norn config set slots.max lots --repo --json
{"error":"repo: /slots/max must be integer","do_instead":"norn config list","code":"invalid_value"}
[exit 3]
$ norn config set nope.key 1 --repo --json
{"error":"no setting 'nope.key'","do_instead":"norn config list","code":"unknown_key"}
[exit 3]
$ norn config set nope 1 --user
**Refused (unknown_key):** no setting 'nope'

Do instead: norn config list
[exit 3]
$ norn config set max_agents 9 --repo --json
{"file":"repo","path":"/private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--13-config-list-get-set-unset/d994b8ef-932a-462d-adef-2c45a5be9f60/scratchpad/qa/repo/.agents/norn/config.yaml","key":"max_agents","value":9,"changed":true}
[exit 0]
$ norn config set limits.deadline forever --repo
**Refused (invalid_value):** repo: /limits/deadline must match ^([0-9]+(ms|s|m|h|d))+$

Do instead: norn config list
[exit 3]
after: 3e9f295133c0ee411dced08773f557d1bb7cbe00 c056802d6e33564dddee8ed168864ecc0da424f8 
git status:
 M .agents/norn/config.yaml
(empty = repo file unchanged)

## rerun: refusals only (max_agents probe above was a valid write; file reset with git checkout)
$ norn config set slots.max lots --repo
**Refused (invalid_value):** repo: /slots/max must be integer

Do instead: norn config list
[exit 3]
$ norn config set nope.key 1 --repo --json
{"error":"no setting 'nope.key'","do_instead":"norn config list","code":"unknown_key"}
[exit 3]
$ norn config set nope 1 --user --json
{"error":"no setting 'nope'","do_instead":"norn config list","code":"unknown_key"}
[exit 3]
$ norn config unset nope --repo --json
{"error":"no setting 'nope'","do_instead":"norn config list","code":"unknown_key"}
[exit 3]
$ norn config set limits.deadline forever --repo --json
{"error":"repo: /limits/deadline must match ^([0-9]+(ms|s|m|h|d))+$","do_instead":"norn config list","code":"invalid_value"}
[exit 3]
repo file byte-for-byte unchanged (cmp)
user file byte-for-byte unchanged (cmp)
