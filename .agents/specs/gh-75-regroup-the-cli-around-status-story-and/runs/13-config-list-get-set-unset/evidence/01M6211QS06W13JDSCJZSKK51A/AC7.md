repo file:
# team config — keep notes here
default_mode: manual   # who starts
# limits for every step
limits:
  deadline: 30m  # long enough
  nudges: 2
slots:
  max: 3

## A. existing scalar changed
$ norn config set limits.deadline 90m --repo
[exit 0]
 1 file changed, 1 insertion(+), 1 deletion(-)
-  deadline: 30m  # long enough
+  deadline: 90m  # long enough

$ norn config set default_mode auto --repo
[exit 0]
 1 file changed, 1 insertion(+), 1 deletion(-)
-default_mode: manual   # who starts
+default_mode: auto   # who starts

$ norn config set slots.max 5 --repo
[exit 0]
 1 file changed, 1 insertion(+), 1 deletion(-)
-  max: 3
+  max: 5

## B. new top-level key
$ norn config set max_agents 1 --repo
[exit 0]
 1 file changed, 3 insertions(+), 2 deletions(-)
-default_mode: manual   # who starts
+default_mode: manual # who starts
-  deadline: 30m  # long enough
+  deadline: 30m # long enough
+max_agents: 1

## C. new key inside an existing map
$ norn config set limits.retries 4 --repo
[exit 0]
 1 file changed, 3 insertions(+), 2 deletions(-)
-default_mode: manual   # who starts
+default_mode: manual # who starts
-  deadline: 30m  # long enough
+  deadline: 30m # long enough
+  retries: 4

## D. new key, file with single-space inline comments only
$ norn config set max_agents 1 --repo
[exit 0]
 1 file changed, 1 insertion(+)
+max_agents: 1

$ norn config set limits.nudges 3 --repo
[exit 0]
 1 file changed, 1 insertion(+)
+  nudges: 3

