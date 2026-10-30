#!/bin/zsh
f=$1; shift
{ echo "$ norn $*"; /var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa75c/n "$@" 2>&1; echo "[exit $?]"; echo; } >> /var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa75c/ev/$f
