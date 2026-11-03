diff --git a/.agents/skills/release/SKILL.md b/.agents/skills/release/SKILL.md
index b8ad13982..6c0888100 100644
--- a/.agents/skills/release/SKILL.md
+++ b/.agents/skills/release/SKILL.md
@@ -1,6 +1,6 @@
 ---
 name: release
-description: Prepare a norn release on the release story's branch — rebuild the changelog from the squash commits on main since the last tag, propose the version with its reason (or apply the one the person gave), bump packages/cli/package.json and the README release badge, and rename the release issue to "Release X.Y.Z". Use in the `release` workflow's `prepare` step.
+description: Prepare a norn release on the release story's branch — rebuild the changelog from the squash commits on main since the last tag, propose the version with its reason (or apply the one the person gave), bump packages/cli/package.json, the README release badge and the repo's norn_version, refresh the bundled skill copies in .agents/skills/, and rename the release issue to "Release X.Y.Z". Use in the `release` workflow's `prepare` step.
 ---
 
 # Release: prepare
@@ -50,18 +50,41 @@ In this order: the version from Rework, else the one in `## Version`, else your
 
 - `version` in `packages/cli/package.json`.
 - The README release badge: `badge/release-vX.Y.Z-blue` and its alt text `Release vX.Y.Z`.
+- The repo's norn version: `norn_version: X.Y.Z` in `.agents/norn.config.yaml` (gh-61 B27). Edit the line in place so the file's comments stay; add it under the header comments when the file has none. Once the PR merges, `main` asks for exactly the binary it publishes.
 
 On a rework with another version, change the section heading and every bump to it; leave no old version behind (`git grep` the old one in these files).
 
-## 6. Rename the issue
+Do this by hand, never with `norn upgrade` (gh-61 D13): `upgrade` runs only in the main checkout, and the norn running this step is the release before the one you prepare.
+
+## 6. Refresh the bundled skills
+
+The bundled skills in `.agents/skills/norn*` are copies of `packages/cli/assets/skills/norn*`; the release ships the sources, so the copies must match them in the same diff as the bump (B27). From the worktree root:
+
+```sh
+for src in packages/cli/assets/skills/norn*/; do
+  name=$(basename "$src")
+  rm -rf ".agents/skills/$name" && cp -R "$src" ".agents/skills/$name"
+  [ -e ".claude/skills/$name" ] || ln -s "../../.agents/skills/$name" ".claude/skills/$name"
+done
+for dst in .agents/skills/norn*/; do
+  [ -d "packages/cli/assets/skills/$(basename "$dst")" ] || echo "no longer bundled: $dst"
+done
+git status --short .agents/skills .claude/skills
+```
+
+Copy only `norn`-prefixed folders: `release`, `release-start` and `issue` are this repo's own skills, never touched here. A folder the second loop names was bundled once and is not any more: remove it and its `.claude/skills/` link. Name the skills that changed in the handoff (none is fine: the copies already matched).
+
+The worktree now holds the new version's skills while the norn running the step is older; norn does not hold this unit's later agent steps for that (gh-61 D14), because its team file records the newer `norn_version`.
+
+## 7. Rename the issue
 
 `gh issue edit <N> --title "Release X.Y.Z"`. The story mirrors the title (GR8) and the PR takes it, so the squash commit on main reads `Release X.Y.Z`. This is the only remote write this skill allows, an exception to the `norn` skill's rule; never edit the issue body.
 
-## 7. Report
+## 8. Report
 
 `norn done done --handoff "Propose X.Y.Z: <reason>. <a> Added, <c> Changed, <f> Fixed; omitted #.., #.."`. With a version from the person: `"Apply X.Y.Z (from <Rework | issue>). …"`.
 
 ## Rules
 
-- Change only `CHANGELOG.md`, `packages/cli/package.json`, `README.md` and `pr.md` in the spec folder (the PR body: the version, its reason and the new changelog section).
+- Change only `CHANGELOG.md`, `packages/cli/package.json`, `README.md`, the `norn_version` line of `.agents/norn.config.yaml`, the `norn*` folders of `.agents/skills/` (and their `.claude/skills/` links), and `pr.md` in the spec folder (the PR body: the version, its reason and the new changelog section).
 - Never tag, publish or push: the merge of the release PR does that in CI.
diff --git a/.agents/workflows/release.yaml b/.agents/workflows/release.yaml
index 5bf7644af..5e913cf0f 100644
--- a/.agents/workflows/release.yaml
+++ b/.agents/workflows/release.yaml
@@ -21,10 +21,14 @@ steps:
       Write the changelog section, the version bumps and the proposed version with its reason as the
       skill says; a version given in the issue's `## Version` or by the person in Rework wins over
       your proposal. Also write the PR body to pr.md in the spec folder: the proposed version, its
-      reason and the new changelog section; norn puts the issue link under it. Rename the issue to
-      "Release X.Y.Z" with `gh issue edit`, the one remote write this step allows. Change no code.
+      reason and the new changelog section; norn puts the issue link under it. In the same diff as
+      the bump, set `norn_version: X.Y.Z` in .agents/norn.config.yaml by editing the file (not with
+      `norn upgrade`, which runs only in the main checkout) and copy packages/cli/assets/skills/norn*
+      over .agents/skills/norn* as the skill says, so that once the PR merges the published binary is
+      the one main asks for. Rename the issue to "Release X.Y.Z" with `gh issue edit`, the one remote
+      write this step allows. Change no code.
     outcomes:
-      done: { to: open-pr, means: "CHANGELOG.md, packages/cli/package.json and the README badge carry version X.Y.Z; pr.md and the handoff name it with its reason" }
+      done: { to: open-pr, means: "CHANGELOG.md, packages/cli/package.json, the README badge and norn_version in .agents/norn.config.yaml carry version X.Y.Z, .agents/skills/norn* match the bundled sources; pr.md and the handoff name it with its reason" }
   update:
     type: git
     action: update
diff --git a/docs/concepts.md b/docs/concepts.md
index dcfd04230..66a24a6da 100644
--- a/docs/concepts.md
+++ b/docs/concepts.md
@@ -81,7 +81,21 @@ Per-tick detail (the trace, locks and caches) stays outside the repository, in o
 
 ## Skills
 
-A step's craft is in a skill: `norn init` copies norn's skills into `.agents/skills/` and links them from each agent's skill folder. The `norn` skill is the protocol every step follows (read the brief, work in scope, report once); the others do one kind of step each. To change how a step is done, write your own skill under another name and name it in the step (`skill: my-review`). `norn doctor` reports skills that are missing, not linked or out of date.
+A step's craft is in a skill: `norn init` copies norn's skills into `.agents/skills/` and links them from each agent's skill folder. The `norn` skill is the protocol every step follows (read the brief, work in scope, report once); the others do one kind of step each. To change how a step is done, write your own skill under another name and name it in the step (`skill: my-review`). `norn doctor` reports skills that are missing or not linked, and fails on a bundled skill that differs from the running norn's copy.
+
+A bundled skill (a `norn`-prefixed folder in `.agents/skills/`) that differs from the running norn's copy is **drift**: norn starts no agent step in a unit whose worktree holds drifted skills, so an agent never follows a protocol from another norn than the one it reports to. Gates, checks, base syncs and merges of that unit go on; `norn brief`, `norn story start` and `norn story chat` refuse there, and the inbox names the fix (`norn story update-branch <story>` for a unit, `norn upgrade` and a commit when the main checkout drifted). Your own skills, without the `norn-` prefix, are never checked.
+
+## The repo's norn version
+
+The team config records **the repo's norn version** (`norn_version: X.Y.Z` in `.agents/norn.config.yaml`): the norn the repo was set up with or last upgraded to. A binary matches it when it is the same minor (before 1.0; the same major from 1.0 on) and at least that patch: a repo at `X.Y.Z` takes `X.Y.Z` and any later patch of `X.Y`, never an earlier patch, never another minor. A patch upgrade of the binary needs no commit; a new minor, which may change how norn reads the config, the workflows or `runs/`, needs `norn upgrade` and a commit.
+
+The version is read from the main checkout's team config, so it changes for you when you pull the base branch, not before. With a binary that does not match:
+
+- every command that acts is refused with exit code 3 (`refused`) and the norn to install, or `norn upgrade` when your binary is newer: `tick`, `watch` (each tick), `sync`, `brief`, `tidy`, `config set|unset`, every `story` verb that changes something, and `run rerun|cancel|attach`. Nothing is written, launched or pushed.
+- the commands that only read run and show the mismatch: `help`, `--version`, `doctor`, `status` (a top Unblock item, and the tab bar line), `story list|view|wait`, `run list|view`, `config list|get`.
+- `init`, `upgrade`, `uninstall`, and the reports an agent already in a step makes (`done`, `ask`, `stuck`, `hook`, and the check runs a tick started), are never refused for it, so a session already started can always report.
+
+A repo without the key works as before; `doctor` and `status` hint to run `norn upgrade`. How to move a team to a new norn is in [Recipes: Roll out a new norn to a team](recipes.md#roll-out-a-new-norn-to-a-team).
 
 ## Glossary
 
@@ -107,6 +121,7 @@ A step's craft is in a skill: `norn init` copies norn's skills into `.agents/ski
 | inbox | Everything that needs a person, with the command that resolves each item (`norn status`). |
 | tick | One pass of the heartbeat: observe, decide, act. |
 | worktree | The git worktree a unit works in. |
+| norn version | The norn version a repo was set up with or last upgraded to (`norn_version` in the team config); a binary of another minor, or an earlier patch, refuses to act on the repo. |
 | slot | A numbered port range a running unit gets, so parallel units do not collide. |
 | trace | The per-tick record of facts and decisions, kept outside the repository. |
 | mailbox | A git ref through which another checkout sends an answer or approval to the one that holds the claim. |
diff --git a/docs/recipes.md b/docs/recipes.md
index a8751c000..bbb77bcb0 100644
--- a/docs/recipes.md
+++ b/docs/recipes.md
@@ -111,3 +111,40 @@ Run a tick from cron every minute in the repository:
 ```
 
 `--interval` tells norn how often the tick runs: it is recorded for the checkout and sets when the heartbeat counts as down and how long a claim lasts. Match it to the cron schedule; without it, norn assumes 30 seconds. Every tick on one checkout shares one heartbeat id, so each recognises the claim the previous one renewed. cron has a minimal `PATH`: give full paths to `norn`, `gh` and your agent, or set `PATH` in the crontab.
+
+## Roll out a new norn to a team
+
+The repo's norn version (`norn_version` in `.agents/norn.config.yaml`, see [Concepts](concepts.md#the-repos-norn-version)) says which norn every machine runs. Moving it is one commit by one person; everyone else pulls and installs.
+
+**The person who upgrades**, in the main checkout:
+
+1. Install the new norn ([README: Install](../README.md#install)) and check it with `norn --version`.
+2. Stop `norn watch` (and any cron tick) on this checkout: `norn upgrade` refuses while a tick runs.
+3. Run `norn upgrade`. It moves `norn_version` to the running binary's version, rewrites the bundled `norn*` skills in `.agents/skills/` to its copies, and makes any layout or config move the new version needs, all staged and nothing committed. It prints what moved; with nothing to move it says so and changes nothing.
+4. Review `git diff --staged`, commit it and push it to the base branch (through a PR if your base branch takes only PRs).
+
+`norn upgrade` never moves the version backward: a binary older than the repo's version is refused with the norn to install. To really go back, edit the key in the team file by hand, where review sees it. `norn migrate` is the old name of `norn upgrade` and still works, with a one-line notice, until the next minor.
+
+**Teammates**, once the commit is on the base branch: pull it into the main checkout, install the same minor (any patch at or after the recorded one), and restart `norn watch`. Until they install, the commands that act refuse with `this repo needs norn X.Y.x (you run …)` and the norn to install; `norn status` shows the same at the top. A `norn watch` started before the pull keeps running: it skips each tick it may not run, sends one notification ("ticks paused"), and resumes by itself once the version matches again. A tick run from cron exits 3 each time instead.
+
+**`norn init` is for a new repo or a new machine**, never for moving the version. On a repo without the key it records the running norn's version. On a repo that has one it sets up your machine and leaves `norn_version` and the bundled skills alone; when they differ from your binary it says so and points at `norn upgrade`. A missing bundled skill is copied in either way.
+
+**Units in flight** wait for their branch to take in the base. A story branch cut before the upgrade still holds the old skills, so after you install the new norn its next agent step is held as drift (the inbox names `norn story update-branch <story>`) until the next base sync, or that command, brings the new skills in; then it launches. Its pinned workflow does not change. A claim held by a machine that is now refused is not handed over: it expires as when a machine stops ticking, and a matching machine takes it over.
+
+**A norn from before this check** does not know the key: on a repo that records a `norn_version` it refuses every command with a config error, `` unknown key `norn_version` ``, exit code 6 (`config`), and writes nothing. The fix is the same: install the norn the repo records.
+
+**Check it in CI.** `norn doctor --repo` checks the repo's norn version against the installed norn, the bundled skills against its copies, and the workflows and config, with no agent, runner or remote. Installing the latest release makes a PR red when the repo is behind it or when someone hand-edited a bundled skill:
+
+```yaml
+  norn:
+    runs-on: ubuntu-latest
+    steps:
+      - uses: actions/checkout@v4
+      - name: Install the latest norn
+        run: |
+          curl -fsSLO https://github.com/PruszynskiJakub/norn-next/releases/latest/download/norn-linux-x64
+          sudo install -m 755 norn-linux-x64 /usr/local/bin/norn
+      - run: norn doctor --repo
+```
+
+To check only the skills, workflows and config, and not lag behind the latest release, install the version the repo records instead: `releases/download/v$(sed -n 's/^norn_version: *//p' .agents/norn.config.yaml)/norn-linux-x64`.
