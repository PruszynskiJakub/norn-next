## AC6: --json, inside a pty (TTY present)
{"error":"norn run view: name the unit (no terminal to ask in)","do_instead":"norn run view gh-2/01 | norn run view gh-1 | norn run view gh-2","code":"target_required"}^M
[exit 2]
{"error":"norn run list: name the unit (no terminal to ask in)","do_instead":"norn run list gh-2/01 | norn run list gh-1 | norn run list gh-2","code":"target_required"}^M
[exit 2]
## AC6: no TTY (stdin /dev/null, stdout piped)
**Usage error (target_required):** norn run view: name the unit (no terminal to ask in)

Do instead: norn run view gh-2/01 | norn run view gh-1 | norn run view gh-2
[exit 2]
**Usage error (target_required):** norn run list: name the unit (no terminal to ask in)

Do instead: norn run list gh-2/01 | norn run list gh-1 | norn run list gh-2
[exit 2]
## AC6: agent launch env NORN_RUN set, inside a pty
**Usage error (target_required):** norn run view: name the unit (no terminal to ask in)^M
^M
Do instead: norn run view gh-2/01 | norn run view gh-1 | norn run view gh-2^M
[exit 2]
## AC6: orient env NORN_ORIENT=1, inside a pty
**Usage error (target_required):** norn run list: name the unit (no terminal to ask in)^M
^M
Do instead: norn run list gh-2/01 | norn run list gh-1 | norn run list gh-2^M
[exit 2]
