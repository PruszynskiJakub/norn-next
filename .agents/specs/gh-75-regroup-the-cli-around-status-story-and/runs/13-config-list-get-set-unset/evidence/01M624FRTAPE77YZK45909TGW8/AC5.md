## AC5 (stdin not a TTY)
$ config set default_mode auto </dev/null
**Usage error (file_required):** which config file? (no terminal to ask in)

Do instead: pass --user or --repo
exit 2
$ config set default_mode auto --json
{"error":"which config file? (no terminal to ask in)","do_instead":"pass --user or --repo","code":"file_required"}
exit 2
$ config unset default_mode </dev/null
**Usage error (file_required):** which config file? (no terminal to ask in)

Do instead: pass --user or --repo
exit 2
