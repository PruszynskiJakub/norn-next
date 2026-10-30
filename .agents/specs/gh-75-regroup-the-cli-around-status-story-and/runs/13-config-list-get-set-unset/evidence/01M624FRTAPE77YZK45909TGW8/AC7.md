## AC7 commented repo file:
# repo config for QA
default_mode: manual   # who drives
limits:
  retries: 2     # padded comment
# notifiers below
notifiers:
  - adapter: os   # os notes

$ config set default_mode 'auto' --repo
Set `default_mode` to `auto` in the repo file (`.agents/norn/config.yaml`).
exit 0
 1 file changed, 1 insertion(+), 1 deletion(-)
@@ -1,5 +1,5 @@
 # repo config for QA
-default_mode: manual   # who drives
+default_mode: auto   # who drives
 limits:
   retries: 2     # padded comment
 # notifiers below

$ config set limits.retries '4' --repo
Set `limits.retries` to `4` in the repo file (`.agents/norn/config.yaml`).
exit 0
 1 file changed, 1 insertion(+), 1 deletion(-)
@@ -1,7 +1,7 @@
 # repo config for QA
 default_mode: manual   # who drives
 limits:
-  retries: 2     # padded comment
+  retries: 4     # padded comment
 # notifiers below
 notifiers:
   - adapter: os   # os notes

$ config set max_agents '1' --repo
Set `max_agents` to `1` in the repo file (`.agents/norn/config.yaml`).
exit 0
 1 file changed, 1 insertion(+)
@@ -5,3 +5,4 @@ limits:
 # notifiers below
 notifiers:
   - adapter: os   # os notes
+max_agents: 1

$ config set limits.stalled '20m' --repo
Set `limits.stalled` to `20m` in the repo file (`.agents/norn/config.yaml`).
exit 0
 1 file changed, 1 insertion(+)
@@ -2,6 +2,7 @@
 default_mode: manual   # who drives
 limits:
   retries: 2     # padded comment
+  stalled: 20m
 # notifiers below
 notifiers:
   - adapter: os   # os notes

$ config set notifiers '[{adapter: os}, {adapter: os}]' --repo
Set `notifiers` to `[{adapter: os}, {adapter: os}]` in the repo file (`.agents/norn/config.yaml`).
exit 0
 1 file changed, 2 insertions(+), 1 deletion(-)
@@ -4,4 +4,5 @@ limits:
   retries: 2     # padded comment
 # notifiers below
 notifiers:
-  - adapter: os   # os notes
+  - adapter: os
+  - adapter: os
