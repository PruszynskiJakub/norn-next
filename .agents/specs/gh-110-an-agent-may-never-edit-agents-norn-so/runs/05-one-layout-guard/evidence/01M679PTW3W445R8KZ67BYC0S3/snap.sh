#!/bin/bash
E=$(dirname "$0"); cd $E/repo; { find . -path ./.git -prune -o -type f -print; find $E/home -type f; } | sort | while read f; do shasum "$f"; done
