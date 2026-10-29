## AC8
--- user file:
default_mode: auto
notifiers:
  - adapter: os
$ config unset default_mode --repo
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
{"files":{"user":{"path":"/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa13-home/config.yaml","exists":true},"repo":{"path":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa13-repo/.agents/norn/config.yaml","exists":true}},"entries":[{"key":"default_mode","value":"auto","source":"user","group":"person","meaning":"who starts unattended steps of a story with no mode set: manual (you) or auto (the tick)"}],"notes":[]}

$ config unset default_mode --user
Removed `default_mode` from the user file (`/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa13-home/config.yaml`).
exit 0
notifiers:
  - adapter: os
{"files":{"user":{"path":"/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa13-home/config.yaml","exists":true},"repo":{"path":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa13-repo/.agents/norn/config.yaml","exists":true}},"entries":[{"key":"default_mode","value":"manual","source":"built-in","group":"person","meaning":"who starts unattended steps of a story with no mode set: manual (you) or auto (the tick)"}],"notes":[]}

$ config unset default_mode --user (file lacks it now)
5e8f2768b8928231ddadb7a3e1f743952adfab61  /var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa13-home/config.yaml
`default_mode` is not set in the user file (`/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa13-home/config.yaml`); nothing changed.
exit 0
5e8f2768b8928231ddadb7a3e1f743952adfab61  /var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa13-home/config.yaml
$ config unset limits.retries --repo (nested key)
Removed `limits.retries` from the repo file (`.agents/norn/config.yaml`).
exit 0
diff --git a/.agents/norn/config.yaml b/.agents/norn/config.yaml
index 1536e89..cd708ef 100644
--- a/.agents/norn/config.yaml
+++ b/.agents/norn/config.yaml
@@ -1,7 +1,4 @@
 # repo config for QA
-default_mode: manual   # who drives
-limits:
-  retries: 2     # padded comment
 # notifiers below
 notifiers:
   - adapter: os   # os notes
$ config unset default_mode --user --repo
**Usage error (usage):** --user and --repo together: pick one file

Do instead: pass --user or --repo
exit 2
$ config unset bogus.key --repo
{"error":"no setting 'bogus.key'","do_instead":"norn config list","code":"unknown_key"}
exit 3
