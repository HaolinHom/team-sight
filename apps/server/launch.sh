#!/bin/sh
set -eu
SCRIPT_DIR=${0%/*}
[ "$SCRIPT_DIR" != "$0" ] || SCRIPT_DIR=.
APP_DIR=$(CDPATH= cd -- "$SCRIPT_DIR" && pwd)
exec "$APP_DIR/run-node.sh" "$APP_DIR/dist/cli.js" "$@"
