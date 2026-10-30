user file:
default_mode: manual
notifiers:
  - adapter: os
== in repo2 (no repo default_mode... repo2 has manual) -> use repo: user + repo both set default_mode
get default_mode: [{"key":"default_mode","value":"manual","source":"repo"}]
$ norn config unset default_mode --repo
Removed `default_mode` from the repo file (`.agents/norn/config.yaml`).
[exit 0]
get: [{"key":"default_mode","value":"manual","source":"user"}]
-default_mode: manual   # who starts
$ norn config unset default_mode --user
Removed `default_mode` from the user file (`/private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--13-config-list-get-set-unset/d994b8ef-932a-462d-adef-2c45a5be9f60/scratchpad/qa/home/config.yaml`).
[exit 0]
user file now:
notifiers:
  - adapter: os
get: [{"key":"default_mode","value":"manual","source":"built-in"}]
== unset a key the file lacks
5e8f2768b8928231ddadb7a3e1f743952adfab61  /private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--13-config-list-get-set-unset/d994b8ef-932a-462d-adef-2c45a5be9f60/scratchpad/qa/home/config.yaml
$ norn config unset default_mode --user --json
{"file":"user","path":"/private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--13-config-list-get-set-unset/d994b8ef-932a-462d-adef-2c45a5be9f60/scratchpad/qa/home/config.yaml","key":"default_mode","removed":false}
[exit 0]
5e8f2768b8928231ddadb7a3e1f743952adfab61  /private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--13-config-list-get-set-unset/d994b8ef-932a-462d-adef-2c45a5be9f60/scratchpad/qa/home/config.yaml
$ norn config unset limits.retries --repo
`limits.retries` is not set in the repo file (`.agents/norn/config.yaml`); nothing changed.
[exit 0]
== unset last key in a map drops the map
$ norn config unset slots.max --repo
Removed `slots.max` from the repo file (`.agents/norn/config.yaml`).
[exit 0]
diff --git a/.agents/norn/config.yaml b/.agents/norn/config.yaml
index 05c1d5c..410831f 100644
--- a/.agents/norn/config.yaml
+++ b/.agents/norn/config.yaml
@@ -1,8 +1,5 @@
 # team config — keep notes here
-default_mode: manual   # who starts
 # limits for every step
 limits:
   deadline: 30m  # long enough
   nudges: 2
-slots:
-  max: 3
== unset at a pty without a flag (pick user, Enter)
spawn /private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--13-config-list-get-set-unset/d994b8ef-932a-462d-adef-2c45a5be9f60/scratchpad/qa/n config unset notifiers
Remove from user (~/.norn/config.yaml) or repo (.agents/norn/config.yaml)? (↑/↓, Enter to pick, Esc to leave)
[2K> user (~/.norn/config.yaml): yours, this machine
[2K  repo (.agents/norn/config.yaml): the team's, committed

Removed `notifiers` from the user file (`/private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--13-config-list-get-set-unset/d994b8ef-932a-462d-adef-2c45a5be9f60/scratchpad/qa/home/config.yaml`).
[exit 0]
[user file empty?]
