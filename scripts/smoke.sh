#!/usr/bin/env bash
# Smoke-test an installed norn: `scripts/smoke.sh <path-to-norn> <expected-version>`.
# Runs it outside any repository and in a fresh git repo as a user would: `norn init`, then a story
# taken in by one tick. The packs and harnesses are bundled as text, so a package or binary that lost
# them fails `doctor`'s workflows check or the intake here.
set -euo pipefail
norn=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
want=$2
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cd "$tmp"
# never the person's own ~/.norn: the machine dir of this throwaway repo goes with it
export NORN_HOME_DIR="$tmp/home"

fail() { echo "smoke: $1"; [ -z "${2:-}" ] || cat "$2"; exit 1; }

"$norn" --version --json > version.json
echo "--version: $(cat version.json)"
grep -q "\"version\":\"$want\"" version.json || fail "expected version $want" version.json
grep -q '"norn-pack-sdlc"' version.json || fail "the sdlc pack is not bundled" version.json

"$norn" help --json > help.json
grep -q '"command":"init"' help.json || fail "help does not list init" help.json

set +e
"$norn" status --json > status.json
code=$?
set -e
[ "$code" = 3 ] && grep -q '"code":"not_a_repo"' status.json || fail "status outside a repo: exit $code" status.json

mkdir repo && cd repo
git init -q -b main
git -c user.name=smoke -c user.email=smoke@norn.invalid commit -q --allow-empty -m init
# manual mode: the tick below takes the story in and starts no agent, so no harness need be installed
"$norn" init --yes --mode manual --json > ../init.json || fail "norn init failed" ../init.json
[ -s .agents/norn.local.yaml ] || fail "norn init did not write .agents/norn.local.yaml" ../init.json
grep -q '"name":"workflows","ok":true' ../init.json || fail "doctor cannot load the shipped workflows" ../init.json

"$norn" story create "Smoke story" --json > ../create.json || fail "story create failed" ../create.json
"$norn" tick --json > ../tick.json || fail "tick failed" ../tick.json
grep -q '"kind":"intake_story"' ../tick.json || fail "the tick took no story in" ../tick.json
"$norn" story list --json > ../list.json || fail "story list failed" ../list.json
grep -q '"title":"Smoke story"' ../list.json || fail "story list does not show the story" ../list.json
echo "smoke ok: $norn"
