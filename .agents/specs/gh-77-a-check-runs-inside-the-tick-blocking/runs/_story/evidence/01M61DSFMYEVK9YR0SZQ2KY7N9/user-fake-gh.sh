#!/bin/sh
case "$1 $2" in
  "api user") echo tester ;;
  "issue list") echo '[{"number":5,"url":"https://github.com/o/r/issues/5","title":"Slow check","body":"b","state":"OPEN","assignees":[{"login":"tester"}],"labels":[{"name":"norn"}],"updatedAt":"2026-10-28T00:00:00Z"}]' ;;
  "issue view") echo '{"number":5,"url":"https://github.com/o/r/issues/5","title":"Slow check","body":"b","state":"OPEN","assignees":[{"login":"tester"}],"labels":[{"name":"norn"}],"updatedAt":"2026-10-28T00:00:00Z"}' ;;
  "pr list") echo '[]' ;;
  *) echo "fake gh: unexpected $*" >&2; exit 1 ;;
esac
