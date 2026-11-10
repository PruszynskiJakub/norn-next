Q=$TMPDIR/qa6-gh317
mk() { rm -rf $Q/$1; cp -R $Q/base $Q/$1; cd $Q/$1
  case $2 in none) sed -i '' '/^norn_version:/d' .agents/norn.config.yaml;; keep) ;; *) sed -i '' "s/^norn_version: .*/norn_version: $2/" .agents/norn.config.yaml;; esac
  git commit -qam "fixture $2" 2>/dev/null; true; }
snap() { { git status --porcelain; git rev-parse HEAD; git diff --staged --stat; find $Q/home -type f 2>/dev/null | sort; find . -path ./.git -prune -o -type f -print | sort | xargs shasum 2>/dev/null; } | shasum | cut -c1-12; }
run() { echo "\$ norn ${*:2}"; local b=$(snap); $Q/bin/$1 "${@:2}" 2>&1; local rc=$?; echo; echo "exit=$rc  repo+machine-dir changed: $([ "$b" = "$(snap)" ] && echo no || echo YES)"; echo; }
