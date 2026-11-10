# 03.AC11 docs check

$ bun run docs:emit && git status --porcelain  → exit 0, no diff

## norn help upgrade
norn upgrade — Move this repo's norn_version and bundled skills to this norn, from norn 0.30 on, staged for you to commit

## Correct passages
13:  <a href="https://github.com/PruszynskiJakub/norn-next/releases"><img src="https://img.shields.io/badge/release-v0.30.0-blue" alt="Latest release"></a>
77:Config is optional: a solo developer on GitHub with Claude Code writes none. It lives in three files: `~/.norn/config.yaml` (your machine and your defaults), `.agents/norn.config.local.yaml` (yours in this repository, gitignored) and `.agents/norn.config.yaml` (the team's, committed); which keys go where is in [Reference: Config](docs/reference.md#config). norn reads GitHub or GitLab from the remote URL; a self-hosted host sets `provider: gh` or `provider: glab` in the team file. A config key an older norn used is refused, naming the key, its replacement and the file to fix. A repository records the norn version it needs (`norn_version`): a binary of another minor refuses to act on it and names the norn to install; `norn upgrade` moves a repository from norn 0.30 on, and one that records no `norn_version`, or one below 0.30, is refused with the path through norn 0.30.x. Moving a team to a new norn is in [Recipes: Roll out a new norn to a team](docs/recipes.md#roll-out-a-new-norn-to-a-team).
docs/recipes.md:147:The repo's norn version (`norn_version` in `.agents/norn.config.yaml`, see [Concepts](concepts.md#the-repos-norn-version)) says which norn every machine runs. Moving it is one commit by one person; everyone else pulls and installs. `norn upgrade` moves a repo from norn 0.30 on: a repo that records no `norn_version`, or one below 0.30, is refused (`version_missing`, `version_too_old`) with the path forward: install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with the new norn (and `norn init` first if norn was never set up there).
docs/reference.md:312:Move this repo's norn_version and bundled skills to this norn, from norn 0.30 on, staged for you to commit

## STALE passages (fail)
24:For your keys the nearer file wins: local over user over built-in. Maps merge key by key; lists and scalars replace, so `agents: {claude: {model: …}}` keeps Claude's built-in `--permission-mode auto`, while setting `agents.claude.args` replaces that list, and `notify: {ntfy: <url>}` keeps OS notifications. A story's mode is, nearest first: the story's own (`norn story edit --auto|--manual`), its workflow's `mode`, the local file, the user file, then `manual`. A key in the wrong file, or one an older norn used, is refused with the file and key to use instead; `norn upgrade` rewrites old files. `norn config` lists every setting in effect and the file it came from; `norn config set <key> <value>` changes one in the file you name with `--user`, `--local` or `--repo`.
101:A finished story's record stays on its ref, so `norn run list` and `norn run view` read it on any machine; the base branch never receives run state. Per-tick detail (the trace, locks and caches) stays in the machine dir too; `norn run view --why` reads it. A repository whose base branch still holds run state from an older norn is pointed to `norn upgrade`, which moves it into the refs ([Recipes: Roll out a new norn to a team](recipes.md#roll-out-a-new-norn-to-a-team)).

Both are hand-written (outside the docs:emit block) and unchanged from origin/main.
