#!/bin/bash
cd /private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-8xK78F/repo
export NORN_HOME_DIR=/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-8xK78F/home USER=tester NORN_MACHINE=box
unset NORN_HOME NORN_UNIT
norn "$@"
