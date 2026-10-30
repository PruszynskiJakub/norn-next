#!/bin/sh
# usage: probe.sh "<integrate#2 command>"
D=$(mktemp -d); cd "$D"; export GIT_CONFIG_GLOBAL=/dev/null GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@x GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@x
git init -q -b story .; echo base > f; git add f; git commit -qm base
git checkout -qb slice; echo slice > f; git commit -qam slice
git checkout -q story; echo story > f; git commit -qam story
git checkout -q slice; git rebase story >/dev/null 2>&1; git rebase --abort
git merge --no-ff story >/dev/null 2>&1; echo resolved > f; git commit -qam "merge"
if sh -c "$1" >out 2>&1; then echo "[$1] clean; f=$(cat f); linear=$(test -z "$(git rev-list --merges story..HEAD)" && echo yes || echo no)"; else echo "[$1] CONFLICT: $(grep -m1 CONFLICT out)"; git rebase --abort 2>/dev/null; fi
