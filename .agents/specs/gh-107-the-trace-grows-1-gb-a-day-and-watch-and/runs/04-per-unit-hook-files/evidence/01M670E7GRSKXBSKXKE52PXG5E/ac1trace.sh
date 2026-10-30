#!/usr/bin/env bash
D=$(cat $TMPDIR/qa-04/benchdir); R=$D/repo
export NORN_HOME_DIR=$D/home NORN_MACHINE=bench; unset NORN_HOME NORN_AGENT NORN_RUN NORN_STORY NORN_SLICE NORN_AGENT_SESSION_ID
cd $R && bun $1/packages/cli/src/main.ts trace gh-1 --events --json > $TMPDIR/qa-04/AC1-trace-events.json; echo "exit=$?"
cd $R && bun $1/packages/cli/src/main.ts trace gh-1 --events > $TMPDIR/qa-04/AC1-trace-events.md; echo "exit=$?"
