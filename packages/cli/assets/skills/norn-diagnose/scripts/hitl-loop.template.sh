#!/usr/bin/env bash
# A reproduction loop with a person in it.
# Copy this file outside the repository, edit the marked part, and run it with `bash`.
# The agent runs the script; the person follows the prompts in the terminal.
#
# Two helpers:
#   act "<instruction>"          show an instruction, wait for Enter
#   capture VAR "<question>"     show a question, read the answer into VAR
#
# At the end the captured values print as KEY=VALUE for the agent to read.
#
# `capture` echoes its answer to the terminal, where the agent reads it: capture
# observations only, and leave signing in to the person as an `act`.

set -euo pipefail

act() {
  printf '\n>>> %s\n' "$1"
  read -r -p "    [Enter when done] " _
}

capture() {
  local var="$1" question="$2" answer
  printf '\n>>> %s\n' "$question"
  read -r -p "    > " answer
  printf -v "$var" '%s' "$answer"
}

# --- edit below ---------------------------------------------------------

act "Open the app at http://localhost:3000 and sign in."

capture ERRORED "Click the 'Export' button. Did it throw an error? (y/n)"

capture ERROR_MSG "Paste the error message, secrets replaced by <REDACTED> (or 'none'):"

# --- edit above ---------------------------------------------------------

printf '\n--- Captured ---\n'
printf 'ERRORED=%s\n' "$ERRORED"
printf 'ERROR_MSG=%s\n' "$ERROR_MSG"
