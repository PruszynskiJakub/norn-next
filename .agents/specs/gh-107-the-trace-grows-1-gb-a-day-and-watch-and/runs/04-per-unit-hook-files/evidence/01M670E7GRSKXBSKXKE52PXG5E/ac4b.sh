#!/usr/bin/env bash
D=$(cat $TMPDIR/qa-04/benchdir); R=$D/repo
export NORN_HOME_DIR=$D/home NORN_MACHINE=bench; unset NORN_HOME NORN_AGENT NORN_RUN NORN_STORY NORN_SLICE NORN_AGENT_SESSION_ID
(cd $R && bun $1/packages/cli/src/main.ts tick --json) > $TMPDIR/qa-04/AC4-tick-readable.json; echo "tick exit=$?"
