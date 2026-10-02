#!/bin/bash
# usage: lines "key|text"
while IFS='|' read -r k t; do printf '%s\t%s\n' "$k" "$t"; done | node /workspace/classics/jungle-book/work/chk.mjs | grep BAD
