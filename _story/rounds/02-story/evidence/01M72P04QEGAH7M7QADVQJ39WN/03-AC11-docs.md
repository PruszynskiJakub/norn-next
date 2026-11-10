## 03.AC11: docs
$ bun run docs:emit && git status --porcelain
$ bun packages/cli/scripts/docs-emit.ts
{"emitted":"docs/reference.md"}
porcelain after docs:emit: ''

$ norn help upgrade
norn upgrade — Move this repo's norn_version and bundled skills to this norn, from norn 0.30 on, staged for you to commit

    norn upgrade [--json]

For the person; an agent runs it only when the person asks it to.

### upgrade in README and docs (lines naming upgrade)
README.md:77:Config is optional: a solo developer on GitHub with Claude Code writes none. It lives in three files: `~/.norn/config.yaml` (your machine and your defaults), `.agents/norn.config.local.yaml` (yours in this repository, gitignored) and `.agents/norn.config.yaml` (the team's, committed); which keys go where is in [Reference: Config](docs/reference.md#config). norn reads GitHub or GitLab from the remote URL; a self-hosted host sets `provider: gh` or `provider: glab` in the team file. A config key an older norn used is refused, naming the key, its replacement and the file to fix. A repository records the norn version it needs (`norn_version`): a binary of another minor refuses to act on it and names the norn to install; `norn upgrade` moves a repository from norn 0.30 on, and one that records no `norn_version`, or one below 0.30, is refused with the path through norn 0.30.x. Moving a team to a new norn is in [Recipes: Roll out a new norn to a team](docs/recipes.md#roll-out-a-new-norn-to-a-team).
docs/recipes.md:103:4. Run `norn upgrade` once: it creates the `norn:wf:docs` label on the remote. Then use it: label an issue `norn:wf:docs`, or start the next round of a story with `norn story edit gh-12 --workflow docs`.
docs/recipes.md:149:The repo's norn version (`norn_version` in `.agents/norn.config.yaml`, see [Concepts](concepts.md#the-repos-norn-version)) says which norn every machine runs. Moving it is one commit by one person; everyone else pulls and installs. `norn upgrade` moves a repo from norn 0.30 on: a repo that records no `norn_version`, or one below 0.30, is refused (`version_missing`, `version_too_old`) with the path forward: install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with the new norn (and `norn init` first if norn was never set up there).
docs/recipes.md:151:**The person who upgrades**, in the main checkout:
docs/recipes.md:154:2. Stop `norn watch` (and any cron tick) on this checkout: `norn upgrade` refuses while a tick runs.
docs/recipes.md:155:3. Run `norn upgrade`. It rewrites the bundled `norn*` skills in `.agents/skills/` to its copies and relinks them into each configured agent's skill folder, then moves `norn_version` to the running binary's version, last, so a run cut short leaves the old version and a rerun finishes it. Everything is staged and nothing committed; it ends with the commit to make, which names the new version (or says only the skills were refreshed). It also creates any label norn uses that is missing on the remote, and a remote it cannot reach is reported without failing the upgrade. With nothing to do it prints `already on norn <version>: nothing to upgrade` and stages nothing.
docs/recipes.md:158:`norn upgrade` never moves the version backward: a binary older than the repo's version is refused with the norn to install. To really go back, edit the key in the team file by hand, where review sees it.
docs/recipes.md:162:**`norn init` is for a new repo or a new machine**, never for moving the version. On a repo with no team file it records the running norn's version; a team file with no `norn_version`, or one below 0.30, is an older norn's repo and init refuses it (`version_missing`, `version_too_old`) with the 0.30 path, writing nothing. On a repo from 0.30 on it sets up your machine and leaves `norn_version` and the bundled skills alone; when they differ from your binary it says so and points at `norn upgrade`. A missing bundled skill is copied in either way.
docs/recipes.md:164:**Units in flight** wait for their branch to take in the base. A story branch cut before the upgrade still holds the old skills, so after you install the new norn its next agent step is held as drift (the inbox names `norn story update-branch <story>`) until the next base sync, or that command, brings the new skills in; then it launches. Its pinned workflow does not change. A claim held by a machine that is now refused is not handed over: it expires as when a machine stops ticking, and a matching machine takes it over.
docs/concepts.md:41:norn reads and writes a few labels on your issues. `norn init` and `norn upgrade` create each one that is missing on the remote, in norn's colour (`#5319E7`) with a description; they never change or delete a label that is there. `norn doctor` warns about a missing one and names `norn upgrade`. A `norn:wf:<name>` label that names no workflow is listed as unused, with the command to delete it: norn deletes nothing, because deleting a label strips it from every issue. When the remote cannot be reached or written (no git remote, `gh`/`glab` missing or logged out, no permission), `init` and `upgrade` still finish and say what to run.
docs/concepts.md:111:A bundled skill (a `norn`-prefixed folder in `.agents/skills/`) that differs from the running norn's copy is **drift**. A unit keeps running on the skills its worktree holds, as it keeps its pinned workflow: its agent steps start, and `norn brief`, `norn story start` and `norn story chat` work there. The inbox shows the difference as a Check item, and the new copies arrive when the story branch merges its base. When the main checkout drifted, the inbox names `norn upgrade` and a commit. Your own skills, without the `norn-` prefix, are never checked.
docs/concepts.md:115:The team config records **the repo's norn version** (`norn_version: X.Y.Z` in `.agents/norn.config.yaml`): the norn the repo was set up with or last upgraded to. A binary matches it when it is the same minor (before 1.0; the same major from 1.0 on) and at least that patch: a repo at `X.Y.Z` takes `X.Y.Z` and any later patch of `X.Y`, never an earlier patch, never another minor. A patch upgrade of the binary needs no commit; a new minor, which may change how norn reads the config, the workflows or the run state, needs `norn upgrade` and a commit.
docs/concepts.md:119:- every command that acts is refused with exit code 3 (`refused`) and the norn to install, or `norn upgrade` when your binary is newer: `tick`, `watch` (each tick), `sync`, `brief`, `tidy`, `config set|unset`, every `story` verb that changes something, and `run rerun|cancel|attach`. Nothing is written, launched or pushed.
docs/concepts.md:121:- `init`, `upgrade`, `uninstall`, and the reports an agent already in a step makes (`done`, `ask`, `stuck`, `hook`, and the check runs a tick started), are never refused for it, so a session already started can always report.
docs/concepts.md:123:A repo without the key, or one recording a version below 0.30, is refused the same way by every command that acts and by `init`, with code `version_missing` or `version_too_old`; `doctor` fails its version check with the same words, and `status` shows it as a top Unblock item pointing to `norn doctor`. Run `norn init` if norn was never set up there; for a repo from an older norn, install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with this norn. How to move a team to a new norn is in [Recipes: Roll out a new norn to a team](recipes.md#roll-out-a-new-norn-to-a-team).
docs/concepts.md:152:| norn version | The norn version a repo was set up with or last upgraded to (`norn_version` in the team config); a binary of another minor, or an earlier patch, refuses to act on the repo. |
docs/reference.md:11:A command a person runs that needs the tick lock (`norn story edit --workflow`, `norn story edit --at`, `norn story checkout`, `norn story handoff`, `norn story close`, `norn story reset`, `norn story reopen`, `norn tidy`, and the claim release when `norn watch` stops) waits for a running tick to finish, up to 60 seconds, with one line on stderr naming the tick it waits for, then runs as usual. Only a tick still running after 60 seconds gets it refused, `busy` with code `tick_locked`; Ctrl-C while it waits stops it with nothing changed. `norn tick` and `norn upgrade` refuse a running tick at once, and `norn story edit --auto|--manual` never waits.
docs/reference.md:26:`norn_version` is the repo's norn version: `norn init` records it on a repo with no team file (and refuses a team file with no or a pre-0.30 one), and only `norn upgrade` moves it (`norn config set|unset` refuse it). A binary of another minor, or an earlier patch, is refused by every command that acts, and so is a repo that records no `norn_version` (`version_missing`) or one below 0.30 (`version_too_old`); see [Concepts: the repo's norn version](concepts.md#the-repos-norn-version) and [Recipes: Roll out a new norn to a team](recipes.md#roll-out-a-new-norn-to-a-team).
docs/reference.md:310:##### `norn upgrade`
docs/reference.md:315:norn upgrade [--json]

### banned mentions (old keys, needs strip, .gitattributes, archive-ref move, norn migrate) near upgrade in README/docs/reference
(end of matches)
- `--hook-command`

##### `norn upgrade`

Move this repo's norn_version and bundled skills to this norn, from norn 0.30 on, staged for you to commit

```sh
norn upgrade [--json]
```

##### `norn doctor`

Check agents, hooks, skills, remote auth and runner on this machine, and the repo workflows and config

```sh
