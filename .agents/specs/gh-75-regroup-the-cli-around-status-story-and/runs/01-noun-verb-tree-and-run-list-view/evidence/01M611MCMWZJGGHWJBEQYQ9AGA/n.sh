#!/bin/bash
cd /private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-8xK78F/repo
export NORN_HOME_DIR=/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-8xK78F/home USER=tester NORN_MACHINE=box
echo "\$ norn $*"
bun /Users/jakubpruszynski/Projects/norn-worktrees/gh-75-regroup-the-cli-around-status-story-and--01-noun-verb-tree-and-run-list-view/packages/cli/src/main.ts "$@"
echo "[exit $?]"; echo
