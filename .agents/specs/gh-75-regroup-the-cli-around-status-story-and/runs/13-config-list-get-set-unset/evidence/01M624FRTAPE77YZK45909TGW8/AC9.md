## AC9 throwaway repo, commented config:
# repo config for QA
default_mode: manual   # who drives
limits:
  retries: 2     # padded comment
# notifiers below
notifiers:
  - adapter: os   # os notes

### set at the terminal, pick repo
spawn /var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa13-bin/pn config set limits.retries 5
Write to user (~/.norn/config.yaml) or repo (.agents/norn/config.yaml)? (↑/↓, Enter to pick, Esc to leave)
[2K> user (~/.norn/config.yaml): yours, this machine
[2K  repo (.agents/norn/config.yaml): the team's, committed
[2A[2K  user (~/.norn/config.yaml): yours, this machine
[2K> repo (.agents/norn/config.yaml): the team's, committed
Set `limits.retries` to `5` in the repo file (`.agents/norn/config.yaml`).

exit 0
diff --git a/.agents/norn/config.yaml b/.agents/norn/config.yaml
index 1536e89..74b1246 100644
--- a/.agents/norn/config.yaml
+++ b/.agents/norn/config.yaml
@@ -1,7 +1,7 @@
 # repo config for QA
 default_mode: manual   # who drives
 limits:
-  retries: 2     # padded comment
+  retries: 5     # padded comment
 # notifiers below
 notifiers:
   - adapter: os   # os notes
1	1	.agents/norn/config.yaml

### set a key the file lacks (limits.deadline 90m), pick repo
spawn /var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa13-bin/pn config set limits.deadline 90m
Write to user (~/.norn/config.yaml) or repo (.agents/norn/config.yaml)? (↑/↓, Enter to pick, Esc to leave)
[2K> user (~/.norn/config.yaml): yours, this machine
[2K  repo (.agents/norn/config.yaml): the team's, committed
[2A[2K  user (~/.norn/config.yaml): yours, this machine
[2K> repo (.agents/norn/config.yaml): the team's, committed
Set `limits.deadline` to `90m` in the repo file (`.agents/norn/config.yaml`).

exit 0
diff --git a/.agents/norn/config.yaml b/.agents/norn/config.yaml
index 1536e89..f8273d1 100644
--- a/.agents/norn/config.yaml
+++ b/.agents/norn/config.yaml
@@ -2,6 +2,7 @@
 default_mode: manual   # who drives
 limits:
   retries: 2     # padded comment
+  deadline: 90m
 # notifiers below
 notifiers:
   - adapter: os   # os notes
1	0	.agents/norn/config.yaml

### unset at the terminal, pick repo
spawn /var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa13-bin/pn config unset default_mode
Remove from user (~/.norn/config.yaml) or repo (.agents/norn/config.yaml)? (↑/↓, Enter to pick, Esc to leave)
[2K> user (~/.norn/config.yaml): yours, this machine
[2K  repo (.agents/norn/config.yaml): the team's, committed
[2A[2K  user (~/.norn/config.yaml): yours, this machine
[2K> repo (.agents/norn/config.yaml): the team's, committed
Removed `default_mode` from the repo file (`.agents/norn/config.yaml`).

exit 0
diff --git a/.agents/norn/config.yaml b/.agents/norn/config.yaml
index 1536e89..021364b 100644
--- a/.agents/norn/config.yaml
+++ b/.agents/norn/config.yaml
@@ -1,5 +1,4 @@
 # repo config for QA
-default_mode: manual   # who drives
 limits:
   retries: 2     # padded comment
 # notifiers below
0	1	.agents/norn/config.yaml

### set then unset back: diff empty?
(empty status = clean)
