#!/usr/bin/env bash
# Smoke-test an installed norn: `scripts/smoke.sh <path-to-norn> <expected-version>`.
# Runs it outside any repository and in a fresh git repo, where `norn init` unpacks the bundled
# skills and workflow templates — so a package or binary that lost its assets fails here.
set -euo pipefail
norn=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
want=$2
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cd "$tmp"

got=$("$norn" --version)
echo "--version: $got"
[ "$got" = "{\"version\":\"$want\"}" ] || { echo "expected version $want"; exit 1; }

"$norn" --help --json | grep -q '"command":"init"' || { echo "--help does not list init"; exit 1; }

set +e
"$norn" status --json > status.json
code=$?
set -e
[ "$code" = 3 ] && grep -q '"code":"not_in_repo"' status.json || { echo "status outside a repo: exit $code, $(cat status.json)"; exit 1; }

mkdir repo && cd repo && git init -q
"$norn" init --json > ../init.json
for f in norn.config.yaml workflows/triage.yaml workflows/reproduce.yaml workflows/refinement.yaml workflows/story.yaml workflows/slice.yaml workflows/quick.yaml; do
  [ -s ".agents/$f" ] || { echo "norn init did not write .agents/$f"; cat ../init.json; exit 1; }
done
[ ! -e .agents/norn ] || { echo "norn init wrote the old layout's .agents/norn/"; exit 1; }
[ -s .claude/skills/norn/SKILL.md ] || { echo "norn init did not install the norn skill"; exit 1; }
echo "smoke ok: $norn"
