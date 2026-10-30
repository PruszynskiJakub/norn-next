| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| AC1 (B11) | pass | AC1.md, qa05-probe.log | 400 lines across 2 day files copied once, in order; noise (pre-run, duplicate, other story, slice) excluded; 2nd tick opens no day file |
| AC2 (B12) | pass | AC2.md, qa05-probe.log | partial copy + live `norn hook` → 401 unique ids, done=[gh-9] |
| AC3 (B11) | pass | AC3.md, slice-tests.txt | no day file opened for a run after since; inbox/status never write backfill.json |

Full suite: 1267 pass, 2 fail, both in check-run.test.ts setup (`h.cleanup` undefined after a failed beforeAll), run while a QA probe loaded the machine; rerun alone 5/5 pass. Typecheck green.
