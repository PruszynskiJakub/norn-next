#!/bin/bash
export NORN_HOME_DIR=/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa-gh110-05/home USER=tester NORN_MACHINE=box
exec bun /Users/jakubpruszynski/Projects/norn-worktrees/gh-110-an-agent-may-never-edit-agents-norn-so--05-one-layout-guard/packages/cli/src/main.ts "$@"
