repo file (committed):
# team config — keep notes here
default_mode: manual   # who starts
# limits for every step
limits:
  deadline: 30m  # long enough
  nudges: 2
slots:
  max: 3
== at a pty: norn config set limits.deadline 2h, pick repo
spawn /private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--13-config-list-get-set-unset/d994b8ef-932a-462d-adef-2c45a5be9f60/scratchpad/qa/n config set limits.deadline 2h
Write to user (~/.norn/config.yaml) or repo (.agents/norn/config.yaml)? (↑/↓, Enter to pick, Esc to leave)
[2K> user (~/.norn/config.yaml): yours, this machine
[2K  repo (.agents/norn/config.yaml): the team's, committed
^[[B
[2A[2K  user (~/.norn/config.yaml): yours, this machine
[2K> repo (.agents/norn/config.yaml): the team's, committed
Set `limits.deadline` to `2h` in the repo file (`.agents/norn/config.yaml`).
[exit 0]
$ git diff
diff --git a/.agents/norn/config.yaml b/.agents/norn/config.yaml
index 05c1d5c..c835537 100644
--- a/.agents/norn/config.yaml
+++ b/.agents/norn/config.yaml
@@ -2,7 +2,7 @@
 default_mode: manual   # who starts
 # limits for every step
 limits:
-  deadline: 30m  # long enough
+  deadline: 2h  # long enough
   nudges: 2
 slots:
   max: 3
== at a pty: norn config unset limits.nudges, pick repo
spawn /private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--13-config-list-get-set-unset/d994b8ef-932a-462d-adef-2c45a5be9f60/scratchpad/qa/n config unset limits.nudges
Remove from user (~/.norn/config.yaml) or repo (.agents/norn/config.yaml)? (↑/↓, Enter to pick, Esc to leave)
[2K> user (~/.norn/config.yaml): yours, this machine
[2K  repo (.agents/norn/config.yaml): the team's, committed
^[[B
[2A[2K  user (~/.norn/config.yaml): yours, this machine
[2K> repo (.agents/norn/config.yaml): the team's, committed
Removed `limits.nudges` from the repo file (`.agents/norn/config.yaml`).
[exit 0]
$ git diff
diff --git a/.agents/norn/config.yaml b/.agents/norn/config.yaml
index c835537..0328da6 100644
--- a/.agents/norn/config.yaml
+++ b/.agents/norn/config.yaml
@@ -3,6 +3,5 @@ default_mode: manual   # who starts
 # limits for every step
 limits:
   deadline: 2h  # long enough
-  nudges: 2
 slots:
   max: 3
== at a pty: norn config set limits.retries 4 (new key), pick repo
spawn /private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--13-config-list-get-set-unset/d994b8ef-932a-462d-adef-2c45a5be9f60/scratchpad/qa/n config set limits.retries 4
Write to user (~/.norn/config.yaml) or repo (.agents/norn/config.yaml)? (↑/↓, Enter to pick, Esc to leave)
[2K> user (~/.norn/config.yaml): yours, this machine
[2K  repo (.agents/norn/config.yaml): the team's, committed
^[[B
[2A[2K  user (~/.norn/config.yaml): yours, this machine
[2K> repo (.agents/norn/config.yaml): the team's, committed
Set `limits.retries` to `4` in the repo file (`.agents/norn/config.yaml`).
[exit 0]
$ git diff
diff --git a/.agents/norn/config.yaml b/.agents/norn/config.yaml
index 0328da6..5df3ad2 100644
--- a/.agents/norn/config.yaml
+++ b/.agents/norn/config.yaml
@@ -1,7 +1,8 @@
 # team config — keep notes here
-default_mode: manual   # who starts
+default_mode: manual # who starts
 # limits for every step
 limits:
-  deadline: 2h  # long enough
+  deadline: 2h # long enough
+  retries: 4
 slots:
   max: 3
