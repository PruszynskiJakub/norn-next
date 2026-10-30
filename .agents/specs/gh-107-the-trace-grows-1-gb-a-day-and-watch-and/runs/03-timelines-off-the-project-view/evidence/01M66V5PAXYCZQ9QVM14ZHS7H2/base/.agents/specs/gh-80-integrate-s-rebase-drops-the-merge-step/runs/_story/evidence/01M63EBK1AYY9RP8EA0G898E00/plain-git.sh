#!/bin/sh
# gh-80 plain-git repro: after the slice merges the story branch and resolves, `git rebase story` conflicts again
set -e
D=$(mktemp -d); cd "$D"; export GIT_CONFIG_GLOBAL=/dev/null GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@x GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@x
git init -q -b story .; echo base > f; git add f; git commit -qm base
git checkout -qb slice; echo slice > f; git commit -qam slice
git checkout -q story; echo story > f; git commit -qam story
git checkout -q slice
git rebase story >/dev/null 2>&1 || { echo "integrate#1: conflict"; git rebase --abort; }
git merge --no-ff story >/dev/null 2>&1 || true
echo resolved > f; git commit -qam "merge story, resolved"
git merge-base --is-ancestor story HEAD && echo "story is ancestor of slice HEAD: yes"
if git rebase story >out 2>&1; then echo "integrate#2: clean (GREEN)"; exit 0; else echo "integrate#2: conflict again (RED):"; grep -E "CONFLICT|Could not apply" out; git rebase --abort; exit 1; fi
