--- released 0.11.1: help --json
brief | norn brief [--json] | []
done | norn done <outcome> --handoff "…" [--findings <file>] [--evidence <dir>] [--criteria <file>] [--note "…" [--note-criterion <id>]]… | ['handoff', 'findings', 'evidence', 'criteria', 'note', 'note-criterion']
ask | norn ask "<question>" [--option "<a>" --option "<b>"] | ['option']
stuck | norn stuck "<reason>" | []
hook | norn hook <event> [--agent claude]  (payload JSON on stdin) | ['agent']
--- branch: help --all --json
brief | norn brief [--json] | []
done | norn done <outcome> --handoff "…" [--findings <file>] [--evidence <dir>] [--criteria <file>] [--note "…" [--note-criterion <id>]]… | ['handoff', 'findings', 'evidence', 'criteria', 'note', 'note-criterion']
ask | norn ask "<question>" [--option "<a>" --option "<b>"] | ['option']
stuck | norn stuck "<reason>" | []
hook | norn hook <event> [--agent claude]  (payload JSON on stdin) | ['agent']
SAME
