#!/bin/sh
set -eu
if ! command -v node >/dev/null 2>&1; then
  echo 'NODE_MISSING: install external Node.js 22.23.4 and add it to PATH.' >&2
  exit 1
fi
cd "$(dirname "$0")"
exec node dist/cli.js "$@"
