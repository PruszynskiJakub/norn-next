== repo2 before:
default_mode: manual
agents:
  claude:
    adapter: claude
    args:
      - --permission-mode
      - auto
    model: opus
limits:
  deadline: 90m
--- user:
default_mode: auto
notifiers:
  - adapter: os
== pick repo (Down, Enter): norn config set limits.deadline 45m
spawn /private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--13-config-list-get-set-unset/d994b8ef-932a-462d-adef-2c45a5be9f60/scratchpad/qa/n config set limits.deadline 45m
Write to user (~/.norn/config.yaml) or repo (.agents/norn/config.yaml)? (↑/↓, Enter to pick, Esc to leave)
[2K> user (~/.norn/config.yaml): yours, this machine
^[[B
[2K  repo (.agents/norn/config.yaml): the team's, committed
[2A[2K  user (~/.norn/config.yaml): yours, this machine
[2K> repo (.agents/norn/config.yaml): the team's, committed
Set `limits.deadline` to `45m` in the repo file (`.agents/norn/config.yaml`).
[exit 0]
== pick user (Enter, preselected): norn config set default_mode manual
spawn /private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--13-config-list-get-set-unset/d994b8ef-932a-462d-adef-2c45a5be9f60/scratchpad/qa/n config set default_mode manual
Write to user (~/.norn/config.yaml) or repo (.agents/norn/config.yaml)? (↑/↓, Enter to pick, Esc to leave)
[2K> user (~/.norn/config.yaml): yours, this machine
[2K  repo (.agents/norn/config.yaml): the team's, committed

Set `default_mode` to `manual` in the user file (`/private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--13-config-list-get-set-unset/d994b8ef-932a-462d-adef-2c45a5be9f60/scratchpad/qa/home/config.yaml`).
[exit 0]
== leave (q): norn config set default_mode auto
spawn /private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--13-config-list-get-set-unset/d994b8ef-932a-462d-adef-2c45a5be9f60/scratchpad/qa/n config set default_mode auto
Write to user (~/.norn/config.yaml) or repo (.agents/norn/config.yaml)? (↑/↓, Enter to pick, Esc to leave)
[2K> user (~/.norn/config.yaml): yours, this machine
[2K  repo (.agents/norn/config.yaml): the team's, committed
**Refused (cancelled):** Nothing picked
[exit 3]
== after, repo:
default_mode: manual
agents:
  claude:
    adapter: claude
    args:
      - --permission-mode
      - auto
    model: opus
limits:
  deadline: 45m
--- user:
default_mode: manual
notifiers:
  - adapter: os
