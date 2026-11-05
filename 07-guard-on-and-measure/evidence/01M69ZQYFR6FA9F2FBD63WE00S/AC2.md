# AC2 (B15) — pass
In a throwaway `git archive HEAD` copy, I added unit tests under packages/view/test/unit/:
- qa-harness.test.ts → `import "../../../../test/support/harness.ts"`
- qa-transcript.test.ts → transcript.ts
- qa-snapshot.test.ts → observe-snapshot.ts
- qa-storegit.test.ts → `import { fetchNornRefs } from "@norn/store"` plus `../../../store/src/git.ts`
- qa-allowed.test.ts → fake-herdr.ts plus golden-harvest.ts
`bun test test/repo/repo.test.ts` exits 1. "(fail) … B15: no unit test imports the cli harness, a helper that imports it, or store's git functions" lists {file, import} for harness, snapshot, git.ts, "fetchNornRefs from @norn/store" and transcript. qa-allowed is **not** listed (fake herdr and the golden harvest stay allowed). B16 also fires for transcript/snapshot. Log: AC2.log. Files removed afterwards.
Known gaps (review notes, not criteria): `import * as store from "@norn/store"` is not matched; a unit test can call allowSpawns().
