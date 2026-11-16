#!/bin/zsh
# usage: mkold.sh <repo> <home> ; fresh repo, init, old-wording workflows from origin/main + custom, norn_version 0.30.0, committed
set -e
R=$1; H=$2; rm -rf $R $H; mkdir -p $R $H; cd $R
git init -q -b main; git commit -q --allow-empty -m init
NORN_HOME_DIR=$H bun /Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/packages/cli/src/main.ts init --json >/dev/null
cp /private/tmp/claude-501/-Users-jakubpruszynski--norn-repos-norn-b68fe828-worktrees-gh-343-a-step-is-written-with-two-keys-for-one/26f879fb-29ed-468d-aba8-6f306806ce15/scratchpad/qa/oldwf/*.yaml .agents/workflows/; cp /private/tmp/claude-501/-Users-jakubpruszynski--norn-repos-norn-b68fe828-worktrees-gh-343-a-step-is-written-with-two-keys-for-one/26f879fb-29ed-468d-aba8-6f306806ce15/scratchpad/qa/oldwf/shared/*.yaml .agents/workflows/shared/
cat > .agents/workflows/solo.yaml <<'Y'
# one agent step
name: solo
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement # the skill it runs
    instructions: |
      Build it.
    outcomes: { done: { to: $done, means: "built", verdict: pass } }
Y
cat > .agents/workflows/shared/greet.yaml <<'Y'
description: Say hello.
start: greet
steps:
  greet:
    type: agent
    skill: norn-implement
    instructions: Say hello.
    outcomes:
      done: { exit: greeted, means: "said hello" }
Y
cat > .agents/workflows/uses.yaml <<'Y'
name: uses
start: hello
steps:
  hello:
    use: greet
    outcomes: { greeted: test }
  test:
    type: check
    run: bun test
    timeout: 5m
    outcomes: { pass: $done, fail: $done }
Y
sed -i '' 's/^norn_version: .*/norn_version: 0.30.0/' .agents/norn.config.yaml
git add -A; git commit -q -m "norn 0.30.0 setup"
