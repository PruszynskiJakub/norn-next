#!/bin/bash
# run.sh <out> <cmd>... : run each norn command line (string) with a 20s cap, record output + exit
E=$(dirname "$0"); out=$1; shift
for c in "$@"; do
  echo "### norn $c"
  ( eval "$E/n.sh $c" 2>&1 & p=$!; ( sleep 20; kill $p 2>/dev/null && echo "[KILLED after 20s]" ) & k=$!; wait $p; rc=$?; kill $k 2>/dev/null; echo "[exit $rc]" )
done > "$out"
