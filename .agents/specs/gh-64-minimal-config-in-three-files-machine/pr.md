## Summary

Config shrinks from 38 keys in two same-schema files to a handful of optional keys, each legal in exactly one file: the user file (machine and your defaults), a new gitignored `.agents/norn.config.local.yaml` (you, in this repo) and the team file. A workflow file gains a top-level `mode` and a `defaults:` block. Everything else is detected, derived or fixed. Old keys are refused with a "Config error" (exit 6) that names the replacement, and `norn migrate` rewrites them.

```text
~/.norn/config.yaml              max_agents (1–9, default 9) · notify {os, ntfy, webhook} · trace.retain
                                 mode · agent · agents.<name> {model, args}
.agents/norn.config.local.yaml   mode · agent · agents.<name>         ← overrides the user file, this repo only (new, gitignored)
.agents/norn.config.yaml         provider · base_branch · workflow · slice_workflow
.agents/workflows/<name>.yaml    mode · defaults: {deadline, nudges, retries, stalled}

story mode   = story (story edit) → workflow → local → user → manual
agent entry  = built-in ⊕ user ⊕ local, field by field (args replaces whole)
no key       : runner (Herdr env / on PATH, else headless), provider (remote URL), git remote (tracked),
               label norn, sync 5m, slots 1–9 × 10 ports, attended wait 2m,
               claim lease max(10m, 4×interval), renew lease/3 (interval recorded by watch / tick --interval)
```

`norn config list` in a fresh repo (dev build, user file `mode: auto` + `agents.claude.model`), abridged:

```text
| `mode`                | `auto`                         | user                 |
| `agents.claude.model` | `claude-opus-5-5`              | user                 |
| `agents.claude.args`  | `["--permission-mode","auto"]` | built-in             |
| `provider`            | `gh`                           | derived: remote URL  |
| `claim.lease`         | `10m`                          | derived: interval 30s|
| `claim.renew`         | `3m20s`                        | derived: interval 30s|
```

Also gone: criteria `needs` and agent `capabilities` (a slice that still has `needs` points at `norn migrate`, never corrupt).

## Evidence

This round is `quick`: there is no QA step and no criteria report. The evidence is the tests at the Plan's seams (S1 cli harness, S2 decide, S3 `buildPorts`, S4 workflow load, S5 repo lint), the last full runs (unit 1079/0, typecheck clean; integration and e2e green in the `test` check) and a dev-build run in a temp repo (output quoted). Review #4 approved after checking B1–B55 against the whole diff.

- **B1** works with no config file
  **Before:** a template team file was written; a user file never.
  **After:** `config.test.ts` "B1: no file written → every setting built in or derived"; `config-runtime.test.ts` "B1: a plain init installs hooks and skills for Claude only".
- **B2** user file takes machine + your keys
  **Before:** user and team file took the same 38 keys.
  **After:** `config.test.ts` "B2, B4, B14": each value shown with source `user` / `repo`.
- **B3** local file overrides the user file in this repo only
  **Before:** did not exist.
  **After:** `config.test.ts` "two repos, one user home": local `mode: auto` in one repo → `auto (local)`; the other repo → `manual (user)`.
- **B4** team file takes exactly provider, base_branch, workflow, slice_workflow
  **After:** `config.test.ts` "B2, B4, B14"; the emitted team schema's properties are exactly those four (`slice-workflow.test.ts` init test).
- **B5** key in the wrong file → `config_wrong_file`
  **Before:** `max_agents` in the team file was accepted.
  **After:** observed: `**Config error (config_wrong_file):** .agents/norn.config.yaml: max_agents belongs in ~/.norn/config.yaml (machine key)`, exit 6. Test: "B5" in `config.test.ts`, one case per file.
- **B6, B17, B53** typos and bad values → `config_invalid` naming file, key, problem
  **Before:** adapter `options` typos ignored silently.
  **After:** `config.test.ts` "B6, B17, B19, B53" (`max_agent`, `mode: automatic`, `agent: claud`, `agents.aider`, `max_agents: 12`, `notify.webhook: not-a-url`).
- **B7** "Config error" title, exit 6, never corrupt
  **Before:** "Corrupt state (corrupt)".
  **After:** `config.test.ts` "B7" (every config-loading command; `status` and `story list` too); `wiring.test.ts` adapter config errors exit 6.
- **B8** empty or missing file sets nothing
  **After:** `config.test.ts` "B8".
- **B9** init gitignores the local file
  **After:** `slice-workflow.test.ts` init test: `.gitignore` gains `.agents/norn.config.local.yaml`; a second init adds nothing.
- **B10, B25** story mode nearest first; workflow `mode`
  **After:** `config-runtime.test.ts` "B10, B13: my mode auto starts gh-1 …; the workflow's mode manual holds gh-2" and "B10: the story's own mode beats the workflow's"; store load test "B25, B26".
- **B11** `mode` (and `stalled`) on a step refused at load
  **After:** store unit test "B11, D17: mode and stalled on a step are refused at load, the step named".
- **B12** auto mode never downgrades for lack of a runner key
  **After:** `wiring.test.ts` "B12: no runner key — the detected runner is built (headless without Herdr)".
- **B13** `agent` picks the agent; built-ins need no entry
  **After:** `config-runtime.test.ts` "B13: a step naming gemini, with no agents entry, launches Gemini"; init and doctor set up only agents in use (B1).
- **B14, B15, B16** agent entries merge field by field; `args` replaces
  **Before:** setting `model` dropped `--permission-mode auto`.
  **After:** observed above (`args` built-in, `model` user); `config-runtime.test.ts` launched argv: "B14: setting a model keeps the built-in --permission-mode auto", "B15: args: [] launches claude with no permission mode"; `config.test.ts` "B3, B16".
- **B18** `max_agents` default 9 caps sessions and checks
  **After:** `decide.test.ts` "max_agents caps launches … others queue (K1)" and the check-cap test (S2).
- **B19, B20** `notify` map; Herdr notifier on inside Herdr
  **Before:** adding ntfy dropped OS notifications.
  **After:** `wiring.test.ts` "B19 (D9): notify builds OS unless os: false, plus ntfy and webhook from their URL", "B20: inside Herdr the Herdr notifier is on by itself".
- **B21** `trace.retain` user file only
  **After:** `config.test.ts` "B21"; tidy/doctor behaviour unchanged (existing tests).
- **B22, B54** provider derived; self-hosted host refused
  **After:** `config.test.ts` "B22, B54". Observed above: `provider gh (derived: remote URL)`.
- **B23, B30, B32** base_branch default, label `norn`, sync 5m
  **After:** existing BS0, intake and sync tests keep passing; `remote.label` → `config_moved` in "B39".
- **B24** `workflow` / `slice_workflow`, `norn:wf:` label wins
  **After:** `config-runtime.test.ts` "B24".
- **B26, B27, B51** workflow `defaults:`, fixed 2m attended wait, old pinned workflows take built-ins
  **After:** `decide.test.ts` "B26, B51 (W2a): a step's own limit, else the workflow's defaults:, else the built-in 60m / 2 / 15m"; inbox test "… fixed 2-minute attended wait (B27)".
- **B28** hook window = longest `stalled`
  **After:** store load test "B28 (S4)".
- **B29, B31** runner and git remote derived
  **After:** `config.test.ts` "B29: herdr on the env's PATH → runner herdr (derived)", "B31: the git remote is the one the base branch tracks".
- **B33** fixed slots, `.env.norn` = `NORN_SLOT` + `PORT_BASE`
  **After:** `config-runtime.test.ts` "B33".
- **B34, B35** recorded tick interval; claim timing derived
  **Before:** a claim of `{lease: 1m, renew: 5m}` passed every check.
  **After:** `config-runtime.test.ts` "B34: ticks every 2 minutes with --interval 2m keep the heartbeat up: no norn watch item", "B34: norn tick --interval records it …"; `decide.test.ts` "gh-64 B35: the claim renews at the period derived from the tick interval" (3m20s at 30s, 6m40s at 5m).
- **B36, B37, B38** `needs` and `capabilities` gone
  **After:** core criteria tests "B36", "QV8, B37: counted per verdict, with no split by capability"; `config-runtime.test.ts` "B38: a slice that still has criteria needs shows under Unblock with norn migrate, not as corrupt".
- **B39** old keys → `config_moved` with replacement and `norn migrate`
  **After:** observed: `default_mode` in the team file → `**Config error (config_moved):** … default_mode is now mode; run norn migrate`, exit 6. Test: `config.test.ts` "B39", one case per key family.
- **B40–B45** `norn migrate` rewrites config, workflows, slices
  **After:** `migrate.test.ts` "norn migrate moves old config keys": user file in place with comments kept, team file staged (B40); limits → `defaults:`, `default_mode` → workflow `mode`, a workflow's own value kept, JSON workflows too (B41, B42); personal/machine keys and unplaceable limits listed with their values, team `notifiers` offered as `notify:` (B43); slice `needs` stripped (B44); second run changes nothing, nothing committed, new-style files left byte-for-byte (B45).
- **B46** `norn config` shows every setting with its source
  **After:** observed above; `config.test.ts` "B46".
- **B47, B48** adapter errors name their file; doctor `FAIL config` line
  **Before:** errors always blamed the team file; doctor stopped at the first bad notifier.
  **After:** `wiring.test.ts` "B47 (D15)" (build and send errors name the file); `config-runtime.test.ts` "B47: the tick goes on and the trace keeps the send error"; housekeeping "gh-64 B48: a bad notify.webhook is a FAIL config line naming its file, counted; the machine checks still run".
- **B49, B50, B55** init starters, modelines, schema copies
  **After:** `slice-workflow.test.ts` init test: commented user file on first init, left alone after; modelines; `.agents/norn.config.schema.json`, `.agents/norn.config.local.schema.json`, `~/.norn/config.schema.json`. `assets.test.ts` "config starters (B49, B50)": every commented key validates in its file once uncommented. Editor completion itself was not observed in an editor; check by opening `.agents/norn.config.yaml` with the YAML language server.
- **B52** docs name no removed key
  **After:** `repo.test.ts` "config docs (gh-64 B52)" over help, the view, README, cookbook, templates, skills and AGENTS.md. Not covered: `.agents/SPEC-herdr-cockpit.md` and `.agents/LIMITATIONS.md` still name `notifiers` / `limits.attended_wait` (review #4 note).

Known, not blocking (review #4): `norn init` on a self-hosted remote refuses before writing anything and its hint names a team file that does not exist yet (recover with `norn config set provider glab --repo`); in the team file `default_mode`'s replacement text says `mode` rather than each workflow's `mode`.

## Merge danger

**Door:** one-way: once released, every existing config with an old key is refused until `norn migrate` runs, and migrate rewrites `~/.norn/config.yaml` in place and the team file, workflows and slices into shapes the previous release does not read. Reverting the code does not un-migrate those files.

**Blast radius:** every user: on upgrade, any command that loads config exits 6 until they run `norn migrate` and commit the staged team changes; teammates on the old release then fail on the new team file. Smaller shifts: `max_agents` defaults to 9 (was 2, with `max_checks` 2), checks now follow the same cap, claim timing comes from the tick interval instead of keys, and a step with `mode` or `stalled` makes its workflow fail to load. This repo's own team file is all comments, so it works with both the released norn and this build.
