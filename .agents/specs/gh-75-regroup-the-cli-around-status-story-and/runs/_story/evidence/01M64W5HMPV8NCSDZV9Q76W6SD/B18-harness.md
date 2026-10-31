$ norn story create --title "Fix login timeout" --workflow gated
gh-81

Created https://github.com/o/r/issues/81 and took it in; it starts like any new story (`norn status`).
[exit 0]

remote issue: {"provider":"gh","number":81,"url":"https://github.com/o/r/issues/81","title":"Fix login timeout","body":"","state":"open","assignees":["tester"],"labels":["norn","norn:wf:gated"],"updated_at":"2099-01-15T10:00:00.000Z"}
$ norn status
Running (2) · agents and checks at work
  gh-5       plan #1 (auto) · 1m
      $ norn run list gh-5
  gh-1       work #3 (auto) · 10s
      $ norn run list gh-1

Recently done (3) · finished in the last 24h
  gh-4/01    $done: done · 2m
      $ norn run list gh-4/01
  gh-2       $done: workflow done — waiting for the PR merge (GR6) · 2m
      $ norn run list gh-2
  gh-4       $done: workflow done — waiting for the PR merge (GR6) · 0s
      $ norn run list gh-4
[exit 0]

