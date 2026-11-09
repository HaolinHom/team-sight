#!/bin/sh
set -eu
SCRIPT_DIR=${0%/*}
[ "$SCRIPT_DIR" != "$0" ] || SCRIPT_DIR=.
APP_DIR=$(CDPATH= cd -- "$SCRIPT_DIR" && pwd)
MODE=external
EXPECTED_SHA256=none
if [ "$MODE" = bundled ]; then
  unset NODE_OPTIONS NODE_PATH
  NODE="$APP_DIR/runtime/node"
  if [ ! -x "$NODE" ]; then
    echo 'NODE_BUNDLED_MISSING: restore the bundled runtime from the release archive.' >&2
    exit 1
  fi
  HASH=$(/usr/bin/shasum -a 256 "$NODE")
  if [ "${HASH%% *}" != "$EXPECTED_SHA256" ]; then
    echo 'NODE_BUNDLED_CORRUPT: restore the bundled runtime from the release archive.' >&2
    exit 1
  fi
else
  NODE=$(command -v node || true)
  if [ -z "$NODE" ]; then
    echo 'NODE_MISSING: install Node.js 22.14+ (<23), or use the bundled edition.' >&2
    exit 1
  fi
fi
cd "$APP_DIR"
"$NODE" --input-type=module -e "import {runtimeProblem} from './dist/runtime.js'; const p=runtimeProblem(); if(p){console.error(p);process.exit(1)}"
exec "$NODE" "$@"
