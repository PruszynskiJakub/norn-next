# AC3 (B52) — what run cancel keeps

Observed with the headless runner (AC9-cancel.txt, AC9-after-cancel.txt):
- agent commit e82b4f0 still on branch gh-5-pay-invoices after cancel;
- the agent's uncommitted file work.txt is still in the worktree (norn's stuck commit 142d1ee committed it, as norn commits what is left when a run ends);
- claim ref refs/norn/claims/gh-5 still there, status shows claim state "mine";
- `norn run rerun gh-5` resumed implement in a fresh session (new run id, new pid, no --resume) — AC9-rerun.txt.
- Test: packages/cli/test/run-rerun-cancel.test.ts (fake runner) green.

Not met as written: "the Herdr pane is still there". RunnerPort.kill for Herdr is
`herdr pane close <pane>` (packages/adapters/src/herdr/index.ts:234-240), so cancelling under the
Herdr runner closes the pane. The slice Notes say to use the runner's kill "as is", so the slice
contradicts itself; review#1 and review#2 left this for a person.

How a person settles it: either accept that Herdr cancel closes the pane (amend B52/AC3), or file
follow-up work for a Herdr stop-without-close. To see it: with runner herdr, start a unit, run
`bun packages/cli/src/main.ts run cancel <unit>` and check `herdr pane list`.
