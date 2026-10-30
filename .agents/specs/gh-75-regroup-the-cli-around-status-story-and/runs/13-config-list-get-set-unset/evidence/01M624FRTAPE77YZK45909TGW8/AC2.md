## AC2
$ config set default_mode auto --user
Set `default_mode` to `auto` in the user file (`/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa13-home/config.yaml`).
exit 0
--- user file:
default_mode: auto
{"files":{"user":{"path":"/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa13-home/config.yaml","exists":true},"repo":{"path":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa13-repo/.agents/norn/config.yaml","exists":true}},"entries":[{"key":"default_mode","value":"manual","source":"repo","group":"person","meaning":"who starts unattended steps of a story with no mode set: manual (you) or auto (the tick)"}],"notes":[]}

(repo file still overrides; unset repo to see user layer)
$ config set default_mode auto --repo
Set `default_mode` to `auto` in the repo file (`.agents/norn/config.yaml`).
exit 0
diff --git a/.agents/norn/config.yaml b/.agents/norn/config.yaml
index 1536e89..8afde69 100644
--- a/.agents/norn/config.yaml
+++ b/.agents/norn/config.yaml
@@ -1,5 +1,5 @@
 # repo config for QA
-default_mode: manual   # who drives
+default_mode: auto   # who drives
 limits:
   retries: 2     # padded comment
 # notifiers below
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

