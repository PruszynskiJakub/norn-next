## AC3: NORN_TRANSCRIPT_UPDATE=1 on base-sync and observe snapshots
 17 pass
 0 fail
sha identical
Oct 31 18:32:30 2026 packages/cli/test/transcripts/base-sync.txt
Oct 31 18:33:22 2026 packages/cli/test/observe-snapshots/fresh-intake.json
Oct 31 18:33:31 2026 packages/cli/test/observe-snapshots/gate-waiting.json
Oct 31 18:33:37 2026 packages/cli/test/observe-snapshots/merged.json
Oct 31 18:33:28 2026 packages/cli/test/observe-snapshots/parked-ask.json
Oct 31 18:33:27 2026 packages/cli/test/observe-snapshots/running-slice.json
git status clean: 0

## AC3 negative control: a pinned transcript edited by hand is rewritten by UPDATE (helper writes to the real folder)
 12 pass
 0 fail
restored by helper: identical to HEAD
