## AC3
$ config set agents.claude.model opus --repo
$ config set limits.deadline 90m --repo
$ config set notifiers [{adapter: os},{adapter: os}] --user
Set `agents.claude.model` to `opus` in the repo file (`.agents/norn/config.yaml`).
exit 0
Set `limits.deadline` to `90m` in the repo file (`.agents/norn/config.yaml`).
exit 0
Set `notifiers` to `[{adapter: os}, {adapter: os}]` in the user file (`/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa13-home/config.yaml`).
exit 0
--- repo diff:
diff --git a/.agents/norn/config.yaml b/.agents/norn/config.yaml
index 1536e89..b7009a7 100644
--- a/.agents/norn/config.yaml
+++ b/.agents/norn/config.yaml
@@ -2,6 +2,14 @@
 default_mode: manual   # who drives
 limits:
   retries: 2     # padded comment
+  deadline: 90m
 # notifiers below
 notifiers:
   - adapter: os   # os notes
+agents:
+  claude:
+    adapter: claude
+    args:
+      - --permission-mode
+      - auto
+    model: opus
--- user file:
default_mode: auto
notifiers:
  - adapter: os
  - adapter: os
{"files":{"user":{"path":"/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa13-home/config.yaml","exists":true},"repo":{"path":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa13-repo/.agents/norn/config.yaml","exists":true}},"entries":[{"key":"agents.claude.model","value":"opus","source":"repo","group":"person","meaning":"a coding agent norn can brief or start"}],"notes":[]}

{"files":{"user":{"path":"/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa13-home/config.yaml","exists":true},"repo":{"path":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa13-repo/.agents/norn/config.yaml","exists":true}},"entries":[{"key":"limits.deadline","value":"90m","source":"repo","group":"team","meaning":"unattended step runs this long, then times out"}],"notes":[]}

{"files":{"user":{"path":"/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa13-home/config.yaml","exists":true},"repo":{"path":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa13-repo/.agents/norn/config.yaml","exists":true}},"entries":[{"key":"notifiers","value":[{"adapter":"os"}],"source":"repo","group":"machine","meaning":"how you are told about new inbox items"}],"notes":[]}

{"files":{"user":{"path":"/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa13-home/config.yaml","exists":true},"repo":{"path":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa13-repo/.agents/norn/config.yaml","exists":true}},"entries":[{"key":"agents.claude","value":{"adapter":"claude","args":["--permission-mode","auto"],"model":"opus"},"source":"repo","group":"person","meaning":"a coding agent norn can brief or start"}],"notes":[]}

## AC2/AC3 in a repo with no repo config (user layer visible)
default_mode: auto
notifiers:
  - adapter: os
  - adapter: os
# Config

- user: `/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa13-home/config.yaml`
- repo: `.agents/norn/config.yaml` (not created)

The repo file overrides the user file, except machine caps, which it can only lower.

## You (usually in the user file)

| Setting | Value | From | What it does |
|---|---|---|---|
| `default_mode` | `auto` | user | who starts unattended steps of a story with no mode set: manual (you) or auto (the tick) |
{"files":{"user":{"path":"/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa13-home/config.yaml","exists":true},"repo":{"path":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa13-repo2/.agents/norn/config.yaml","exists":false}},"entries":[{"key":"notifiers","value":[{"adapter":"os"},{"adapter":"os"}],"source":"user","group":"machine","meaning":"how you are told about new inbox items"}],"notes":[]}

$ config set notifiers "[{adapter: os}]" --user  (replaces the 2-item list whole)
Set `notifiers` to `[{adapter: os}]` in the user file (`/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa13-home/config.yaml`).
exit 0
default_mode: auto
notifiers:
  - adapter: os
{"files":{"user":{"path":"/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa13-home/config.yaml","exists":true},"repo":{"path":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa13-repo2/.agents/norn/config.yaml","exists":false}},"entries":[{"key":"notifiers","value":[{"adapter":"os"}],"source":"user","group":"machine","meaning":"how you are told about new inbox items"}],"notes":[]}

