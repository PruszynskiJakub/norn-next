## AC6
52919587b6b9f24e0c5feee62fad422781adfbb6  .agents/norn/config.yaml
fbe2b7cb8228721ee63e72d7aa6978b4121943df  /var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa13-home/config.yaml
$ config set slots.max lots --repo
**Refused (invalid_value):** repo: /slots/max must be integer

Do instead: norn config list
exit 3
$ config set slots.max lots --repo --json
{"error":"repo: /slots/max must be integer","do_instead":"norn config list","code":"invalid_value"}
exit 3
$ config set nonsense.key 1 --repo
{"error":"no setting 'nonsense.key'","do_instead":"norn config list","code":"unknown_key"}
exit 3
$ config set limits.bogus 1 --user
{"error":"no setting 'limits.bogus'","do_instead":"norn config list","code":"unknown_key"}
exit 3
$ config set default_mode sometimes --user
{"error":"user: /default_mode must be \"manual\"; /default_mode must be \"auto\"; /default_mode must match a schema in anyOf","do_instead":"norn config list","code":"invalid_value"}
exit 3
.agents/norn/config.yaml: OK
/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa13-home/config.yaml: OK
