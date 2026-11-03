import json
T="AC-tests.log (typecheck, unit 1151/0 fail, integration 686 pass 3 skip 0 fail, e2e 73/0 fail)"
v={
"01.AC1":("why-version.test.ts 'a harness built as norn 0.18.1 prints 0.18.1…'; hands-on: NV=0.18.1 nn --version → {\"version\":\"0.18.1\"} (B6-B8.md); released/dev default 0.18.0",["B6-B8.md"]),
"01.AC2":("all tiers green unchanged; grep: only packages/cli/src/context.ts:18 imports NORN_VERSION (runningVersion)",[]),
"02.AC1":("store skills.test.ts 'skillsDrift names only the bundled skills that differ…'; hands-on: edited norn-review + missing norn-tdd + repo-local release → doctor names only norn-review (B23-B25.md, B28-B30-K.md)",["B23-B25.md"]),
"02.AC2":("doctor prints the same skills line 'norn-review differs from norn 0.19.0's copy' (now FAIL per slice 10/B24, which supersedes the warning)",["B23-B25.md"]),
"03.AC1":("upgrade.test.ts old-layout tests green; hands-on: `migrate` prints the one deprecation line on stderr and the same JSON as upgrade (B13-B17.md)",["B13-B17.md"]),
"03.AC2":("hands-on: upgrade in a worktree with .norn-unit → exit 3 not_main_checkout naming main checkout (B13b-B29.md); with tick lock held (note 'norn watch') → exit 3, do_instead 'stop `norn watch` and run it again', rerun identical, git status clean (B29-lock.md)",["B13b-B29.md","B29-lock.md"]),
"03.AC3":("help lists upgrade and 'migrate Deprecated: the old name of norn upgrade' (B28-B30-K.md); moved key error says 'run `norn upgrade`' (B13b-B29.md); printed-commands test green",["B28-B30-K.md","B13b-B29.md"]),
"03.AC4":("docs lint (test/repo/docs.test.ts) and reference staleness test green; docs/recipes.md names norn upgrade",[]),
"04.AC1":("schema version.test.ts table green; hands-on: repo 0.19.0 with 0.19.2 matches (doctor PASS), 0.18.1/0.20.0 refused; repo 0.19.2 with 0.19.1 refused 'needs norn 0.19.2 or a later 0.19.x'",["B13-B17.md","B6-B8.md"]),
"04.AC2":("hands-on: norn_version: banana → config_invalid naming .agents/norn.config.yaml and key norn_version, exit 6 (B3-B5.md)",["B3-B5.md"]),
"04.AC3":("hands-on: key in local file and in ~/.norn/config.yaml → config_wrong_file 'belongs in `.agents/norn.config.yaml`', exit 6 (B3-B5.md)",["B3-B5.md"]),
"04.AC4":("hands-on: config get norn_version → 0.19.0 from repo; without key → 'not recorded: `norn upgrade` records it'; config list includes it (B3-B5.md)",["B3-B5.md"]),
"04.AC5":("hands-on: config set/unset norn_version → exit 3 written_by_norn, do_instead 'norn upgrade', file unchanged (B3-B5.md); schema/reference staleness tests green",["B3-B5.md"]),
"04.AC6":("released norn 0.18.0 in throwaway repo with norn_version: 0.19.0 → config_invalid \"unknown key `norn_version`\", exit 6; repo git status unchanged, no files written in its home (B28-B30-K.md); documented in docs/recipes.md",["B28-B30-K.md"]),
"05.AC1":("hands-on: tick as 0.18.1 at 0.19.0 → version_mismatch 'this repo needs norn 0.19.x (you run 0.18.1)', do_instead 'install norn 0.19.x', exit 3, git status clean (B6-B8.md); version-guard.test.ts AC1 green",["B6-B8.md"]),
"05.AC2":("version-class.test.ts + version-guard.test.ts AC2 green; hands-on: sync, brief, tidy, config set, story start, run cancel all refused identically, exit 3 (B6-B8.md)",["B6-B8.md"]),
"05.AC3":("hands-on: binary 0.20.0 at 0.19.0 → do_instead 'run `norn upgrade` to move this repo to norn 0.20.0 and commit the change, or install norn 0.19.x', exit 3 (B6-B8.md)",["B6-B8.md"]),
"05.AC4":("version-guard.test.ts AC4 green (exit codes compared); hands-on: --version, help, story list, run list, config list/get, status, doctor run on mismatch (B6-B8.md); init/upgrade/migrate ran on other versions (B13-B17.md, B28-B30-K.md)",["B6-B8.md"]),
"05.AC5":("version-guard.test.ts 'AC5: done, ask, stuck and hook are accepted…' and 'check-run … writes its receipt' green",[]),
"05.AC6":("version-guard.test.ts AC6 (remote base not counted until pulled; unit worktree team file never read) green",[]),
"05.AC7":("hands-on: no key → tick runs (sync attempted), no refusal; banana → exit 6 config error, not version refusal (B3-B5.md); version-guard AC7 green",["B3-B5.md"]),
"06.AC1":("version-inbox.test.ts green; hands-on status top item '! this repo needs norn 0.19.x (you run 0.18.1): install norn 0.19.x' (B6-B8.md)",["B6-B8.md"]),
"06.AC2":("hands-on: no key → Check item 'no norn version recorded: run `norn upgrade`'; match → no item (B3-B5.md, B23-B25.md); version-inbox.test.ts green",["B3-B5.md"]),
"06.AC3":("hands-on: status on mismatch exit 0 with mismatch on top; `status --segment` → 'norn·repo ! this repo needs norn 0.19.x (you run 0.18.1)' (B6-B8.md); version-status/segment tests + inbox parity green",["B6-B8.md"]),
"06.AC4":("dev build (wrapper over runCli with injected version) in throwaway repo: status shows the mismatch as first line with the install hint and `$ norn doctor` — readable at a glance (B6-B8.md)",["B6-B8.md"]),
"07.AC1":("watch-version.test.ts AC1 green (one notification); hands-on: watch --max-ticks 5 with repo moved to 0.20.0 mid-run → ticks 2–3 print version_mismatch lines, summary skipped_version: 2, exit 0 (watch.err, watch.out)",["watch.err","watch.out"]),
"07.AC2":("hands-on: version moved back → ticks 4–5 ran normally (watch.err); watch-version.test.ts AC2 (notify again on another version) green",["watch.err"]),
"08.AC1":("hands-on: repo at 0.17.0 + edited norn skill → 'norn version 0.17.0 → 0.19.0; skills updated: norn', both staged, nothing committed, comments kept; with default_mode key → moved and listed (B13-B17.md, B13b-B29.md); upgrade-version.test.ts green",["B13-B17.md","B13b-B29.md"]),
"08.AC2":("hands-on: 'already on norn 0.19.0: nothing to upgrade', git status empty (B13-B17.md)",["B13-B17.md"]),
"08.AC3":("hands-on: 0.19.2 upgrade writes norn_version: 0.19.2; after commit 0.19.1 tick refused exit 3 (B13-B17.md)",["B13-B17.md"]),
"08.AC4":("hands-on: 0.18.1 upgrade and migrate → version_backward 'this repo is set up for norn 0.19.0; upgrade will not move it back', do_instead 'install norn 0.19.x', exit 3, git status clean (B13-B17.md)",["B13-B17.md"]),
"08.AC5":("dev-build upgrade output (summary line, skills, staged file, commit hint) and `git diff --staged` (version line + skill revert) read as one reviewable change (B13-B17.md)",["B13-B17.md"]),
"09.AC1":("hands-on: init (0.19.0) on fresh repo → 'norn version: 0.19.0 (recorded)', norn_version: 0.19.0 in untracked team file with the rest (init.md in B... see report.md)",["init.md"]),
"09.AC2":("hands-on: 0.19.2 init on repo at 0.19.0 with norn-review edited and norn-tdd missing → copies norn-tdd, keeps norn-review and norn_version 0.19.0, prints 'this repo is on norn 0.19.0, you run 0.19.2: `norn upgrade` moves it, with the bundled skills that differ: norn-review' (B28-B30-K.md)",["B28-B30-K.md"]),
"09.AC3":("hands-on: same-version init repairs norn-review (B28-B30-K.md); e2e transcripts green (unchanged-or-updated, all 73 e2e pass)",["B28-B30-K.md"]),
"10.AC1":("hands-on: 0.19.2 → 'ok norn 0.19.2 matches this repo's norn version 0.19.0' exit 0; 0.18.1 → 'FAIL norn 0.18.1 does not match…' '→ install norn 0.19.x' (B3-B5.md, B6-B8.md)",["B3-B5.md","B6-B8.md"]),
"10.AC2":("hands-on: no key → 'warn norn no norn version recorded: run `norn upgrade`' (B3-B5.md)",["B3-B5.md"]),
"10.AC3":("hands-on: edited norn-review → 'FAIL skills norn-review differs from norn 0.19.0's copy' + '→ run `norn upgrade` and commit (git diff .agents/skills/ shows the change)', exit 1; repo-local release skill not mentioned (B23-B25.md)",["B23-B25.md"]),
"10.AC4":("hands-on: doctor --repo (no remote/runner set up): edited skill → exit 1; clean → exit 0; older repo version (binary 0.20.0) → FAIL norn exit 1 (B23-B25.md)",["B23-B25.md"]),
"11.AC1":("core skills-drift.test.ts (held slice, sibling launched, manual mode held, check/gate/base sync still decided) and golden rule-case test green",[]),
"11.AC2":("skills-drift-hold.test.ts 'AC2 (D14)…' green",[]),
"11.AC3":("skills-drift.test.ts B19 tests green; hands-on: drifted main checkout → status Unblock 'skills differ from norn 0.19.0: run `norn upgrade` and commit' (B23-B25.md)",["B23-B25.md"]),
"11.AC4":("skills-drift-hold.test.ts AC4 + skills-drift.test.ts B21 green; hands-on: repo-local release skill never named (B23-B25.md)",["B23-B25.md"]),
"11.AC5":("skills-drift-hold.test.ts AC5 (tick launches gh-8 not gh-7; status item; inbox parity) green",[]),
"12.AC1":("skills-drift-refusal.test.ts 'AC1, AC2 (B20)' green",[]),
"12.AC2":("skills-drift-refusal.test.ts 'AC1, AC2 (B20)' green (story start, story chat)",[]),
"12.AC3":("skills-drift-refusal.test.ts AC3 (B21) and AC3 (D14) green",[]),
"13.AC1":("test/e2e/base-sync.test.ts 'gh-61 B22: a story in flight waits…' green (e2e 73/0)",[]),
"14.AC1":("reference staleness and docs lint green; docs/reference.md lists norn_version and upgrade",[]),
"14.AC2":("read docs/concepts.md 'The repo's norn version' and docs/recipes.md 'Roll out a new norn to a team': key, match rule, refused/not refused lists, upgrade path, init never moves it, migrate rename, in-flight units, older norn's config_invalid exit 6 (matches 04.AC6 observation), CI doctor --repo snippet (binary name norn-linux-x64 exists in releases)",["docs-release.md"]),
"14.AC3":("read .agents/skills/release/SKILL.md (new §5 norn_version line, §6 refresh bundled skills loop, allowed-files list) and .agents/workflows/release.yaml prepare instructions + done meaning: set norn_version X.Y.Z and copy assets/skills/norn* in the same diff",["docs-release.md"]),
}
out=[]
for k,(e,f) in v.items():
    out.append({"id":k,"verdict":"pass","evidence":e+(" — files: "+", ".join(f) if f else "")+"; "+T})
json.dump(out,open("criteria.json","w"),indent=1)
with open("report.md","w") as r:
    r.write("| Criterion | Verdict | Evidence |\n|---|---|---|\n")
    for k,(e,f) in v.items(): r.write(f"| {k} | pass | {', '.join(f) or 'AC-tests.log'} |\n")
print(len(out))
