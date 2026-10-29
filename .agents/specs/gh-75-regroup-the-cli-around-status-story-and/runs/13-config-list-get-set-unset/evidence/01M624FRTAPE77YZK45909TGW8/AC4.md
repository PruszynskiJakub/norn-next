## AC4 (person env via env -i HOME PATH TERM NORN_HOME_DIR; pty via expect)
### pick → user (Enter on first option)
spawn /var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa13-bin/pn config set default_mode auto
Write to user (~/.norn/config.yaml) or repo (.agents/norn/config.yaml)? (↑/↓, Enter to pick, Esc to leave)
[2K> user (~/.norn/config.yaml): yours, this machine
[2K  repo (.agents/norn/config.yaml): the team's, committed
Set `default_mode` to `auto` in the user file (`/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa13-home/config.yaml`).

exit 0
--- user file:
notifiers:
  - adapter: os
default_mode: auto
--- git status:

### pick → repo (Down, Enter)
spawn /var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa13-bin/pn config set default_mode auto
Write to user (~/.norn/config.yaml) or repo (.agents/norn/config.yaml)? (↑/↓, Enter to pick, Esc to leave)
[2K> user (~/.norn/config.yaml): yours, this machine
[2K  repo (.agents/norn/config.yaml): the team's, committed
[2A[2K  user (~/.norn/config.yaml): yours, this machine
[2K> repo (.agents/norn/config.yaml): the team's, committed
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

### leave the pick (Ctrl-C)
52919587b6b9f24e0c5feee62fad422781adfbb6  .agents/norn/config.yaml
9c43118a102e822b5990400eff21abf519814b21  /var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa13-home/config.yaml
spawn /var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa13-bin/pn config set default_mode manual
Write to user (~/.norn/config.yaml) or repo (.agents/norn/config.yaml)? (↑/↓, Enter to pick, Esc to leave)
^C
exit 130
52919587b6b9f24e0c5feee62fad422781adfbb6  .agents/norn/config.yaml
9c43118a102e822b5990400eff21abf519814b21  /var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa13-home/config.yaml

### same command from the agent session env with a pty
spawn /var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa13-bin/dn config set default_mode auto
**Usage error (file_required):** which config file? (no terminal to ask in)

Do instead: pass --user or --repo
send: spawn id exp5 not open
    while executing
"send "\r" "
    invoked from within
"if {$choice eq "esc"} { send "\003" } else { send "\r" }"
    (file "/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa13-bin/pick.exp" line 11)

### leave the pick (Esc), retried waiting for the options
52919587b6b9f24e0c5feee62fad422781adfbb6  .agents/norn/config.yaml
9c43118a102e822b5990400eff21abf519814b21  /var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa13-home/config.yaml
(eval):6: command not found: timeout
52919587b6b9f24e0c5feee62fad422781adfbb6  .agents/norn/config.yaml
9c43118a102e822b5990400eff21abf519814b21  /var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa13-home/config.yaml

### leave the pick (Ctrl-C)
(eval):7: command not found: timeout
52919587b6b9f24e0c5feee62fad422781adfbb6  .agents/norn/config.yaml
9c43118a102e822b5990400eff21abf519814b21  /var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa13-home/config.yaml

### leave the pick (Esc), waiting for the options
spawn /var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa13-bin/pn config set default_mode manual
Write to user (~/.norn/config.yaml) or repo (.agents/norn/config.yaml)? (↑/↓, Enter to pick, Esc to leave)
[2K> user (~/.norn/config.yaml): yours, this machine
[2K  repo (.agents/norn/config.yaml): the team's, committed
**Refused (cancelled):** Nothing picked

exit 3
52919587b6b9f24e0c5feee62fad422781adfbb6  .agents/norn/config.yaml
9c43118a102e822b5990400eff21abf519814b21  /var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa13-home/config.yaml

### leave the pick (Ctrl-C)
spawn /var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa13-bin/pn config set default_mode manual
Write to user (~/.norn/config.yaml) or repo (.agents/norn/config.yaml)? (↑/↓, Enter to pick, Esc to leave)
[2K> user (~/.norn/config.yaml): yours, this machine
[2K  repo (.agents/norn/config.yaml): the team's, committed
**Refused (cancelled):** Nothing picked

exit 3
52919587b6b9f24e0c5feee62fad422781adfbb6  .agents/norn/config.yaml
9c43118a102e822b5990400eff21abf519814b21  /var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa13-home/config.yaml
