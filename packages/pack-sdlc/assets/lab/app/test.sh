#!/bin/sh
# the toy app's test, which the lab's check runs: greet.sh prints the greeting below
want="hello"
got="$(sh greet.sh)"
if [ "$got" = "$want" ]; then
  echo "ok: greet.sh prints '$want'"
else
  echo "FAIL: greet.sh printed '$got', want '$want'"
  exit 1
fi
