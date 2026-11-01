# AC3
Test "AC3 secret env" spawns with env {MY_TOKEN: <REDACTED secret-looking value>} and cwd /tmp/hidden-dir. Message contained only the argv/file/test/integration/. `grep -c` for the secret value, MY_TOKEN and hidden-dir in the full log: 0 and 0.
