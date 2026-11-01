# AC3

Verifier: test. Test: `packages/cli/test/integration/human.test.ts:1002` — "B12 (AC3, AC8): --force while an agent runs explore is refused, pointing to run cancel".
Run: `bun test --config=bunfig.integration.toml packages/cli/test/integration/human.test.ts packages/cli/test/integration/run-rerun-cancel.test.ts` → 58 pass, 0 fail (tests.txt).

Fake runner runs explore; refusal agent_running, exit 3, 'an agent is running explore of gh-22's triage round; stop it first', do_instead 'norn run cancel gh-22'; record files + branch head unchanged.
