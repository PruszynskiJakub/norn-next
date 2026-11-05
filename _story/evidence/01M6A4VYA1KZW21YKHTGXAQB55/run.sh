set -u
cd "$1"; E="$2"
git rev-parse HEAD > $E/HEAD.txt
t(){ name=$1; shift; s=$(date +%s); "$@" > $E/$name.log 2>&1; rc=$?; echo "$name rc=$rc $(( $(date +%s)-s ))s load=$(uptime | sed 's/.*averages: //')" >> $E/timings.txt; }
for i in 1 2 3; do t B3-unit-run$i bash -c 'time bun run test'; done
t bun-test bash -c 'bun test'
t typecheck bun run typecheck
for i in 1 2 3; do t B5-int-run$i bash -c 'time bun run test:integration'; done
for i in 1 2 3; do t B6-e2e-run$i bash -c 'time bun run test:e2e'; done
t B18-golden bun run golden
git status --porcelain > $E/B18-status-after-golden.txt
t B18-golden-update bun run golden -- --update
git status --porcelain > $E/B18-status-after-update.txt
t B19-transcript bash -c 'NORN_TRANSCRIPT_UPDATE=1 bun run test:e2e test/e2e/base-sync.test.ts'
git status --porcelain > $E/B19-status.txt
echo ALLDONE >> $E/timings.txt
