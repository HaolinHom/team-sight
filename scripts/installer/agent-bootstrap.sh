set -euo pipefail
umask 077
unset NODE_OPTIONS NODE_PATH BASH_ENV ENV
VERSION='@VERSION@'
VARIANT='@VARIANT@'
ARCHIVE='@ARCHIVE@'
EXPECTED='@ARCHIVE_SHA@'
PAYLOAD_SHA='@PAYLOAD_SHA@'
RUNTIME_SHA='@RUNTIME_SHA@'
URL='@URL@'
BASE="$HOME/Library/Application Support/TeamSight MCP"
MODE=agent-install
TEST_FLAG=production
PORT=43127
SELECTED_NODE=
CURL_ARGS=()
die() { printf 'TeamSight: %s\n' "$1" >&2; exit 1; }
[ "$(/usr/bin/uname -s)" = Darwin ] && [ "$(/usr/bin/uname -m)" = arm64 ] || die 'UNSUPPORTED_PLATFORM: run on macOS arm64 outside Rosetta'
[ "$(/usr/bin/id -u)" != 0 ] || die 'DO_NOT_RUN_WITH_SUDO'
if [ "$#" -ne 0 ]; then
  [ "$#" -eq 5 ] && [ "$1" = --test ] || die 'INVALID_ARGUMENT'
  case "$2" in /*/teamsight-installer-test-*) ;; *) die 'INVALID_TEST_ROOT' ;; esac
  [[ "$2" != */../* && "$2" != */./* && "$3" =~ ^https://(localhost|127\.0\.0\.1):[0-9]+$ && -f "$4" ]] || die 'INVALID_TEST_DOWNLOAD'
  [[ "$5" =~ ^[1-9][0-9]{3,4}$ ]] && [ "$5" -ge 1024 ] && [ "$5" -le 65535 ] || die 'INVALID_PORT'
  BASE=$2; URL="$3/$ARCHIVE"; CURL_ARGS=(--cacert "$4"); PORT=$5; TEST_FLAG=test
fi
/bin/launchctl print "gui/$(/usr/bin/id -u)" >/dev/null 2>&1 || die 'NO_GUI_SESSION: run while logged in to macOS'
TEMP=$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/teamsight-agent-install.XXXXXX")
trap '/bin/rm -rf "$TEMP"' EXIT
CHILD_PID=
interrupted() {
  trap '' INT TERM
  if [ -n "$CHILD_PID" ]; then
    kill -TERM "$CHILD_PID" 2>/dev/null || true
    wait "$CHILD_PID" 2>/dev/null || true
  fi
  exit "$1"
}
trap 'interrupted 130' INT
trap 'interrupted 143' TERM
file_hash() { local result; result=$(/usr/bin/shasum -a 256 "$1") || die 'HASH_READ_FAILED'; printf '%s' "${result%% *}"; }
state_value() { /usr/bin/plutil -extract "$1" raw -o - "$BASE/installer-state.json" || die 'INSTALLER_STATE_INVALID'; }
version_pattern='^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$'
use_installed() {
  local installed=$1 kind=$2 field
  local -a installed_parts release_parts
  IFS=. read -r -a installed_parts <<< "$installed"
  IFS=. read -r -a release_parts <<< "$VERSION"
  for field in 0 1 2; do
    [ "${installed_parts[$field]}" -le "${release_parts[$field]}" ] || return 0
    [ "${installed_parts[$field]}" -ge "${release_parts[$field]}" ] || return 1
  done
  [ "$kind" = "$VARIANT" ]
}
check_node() {
  case "$SELECTED_NODE" in /*) ;; *) die 'NODE_MISSING: install compatible Node or use bundled' ;; esac
  [ -x "$SELECTED_NODE" ] || die 'NODE_MISSING: install compatible Node or use bundled'
  "$SELECTED_NODE" -e 'const [major,minor]=process.versions.node.split(".").map(Number);process.exit(major===22&&minor>=14&&Number(process.versions.napi)>=10&&process.arch==="arm64"?0:1)' || die 'NODE_UNSUPPORTED: requires arm64 Node 22.14+ (<23), Node-API 10+'
}
for PART in "$HOME" "$(/usr/bin/dirname "$BASE")" "$BASE" "$BASE/versions" "$BASE/installer-state.json"; do
  [ ! -L "$PART" ] || die 'SYMLINK_PATH_REFUSED'
done
if [ -e "$BASE/installer-state.json" ]; then
  [ -f "$BASE/installer-state.json" ] && [ "$(/usr/bin/stat -f '%u:%Lp' "$BASE/installer-state.json")" = "$(/usr/bin/id -u):600" ] || die 'INSTALLER_STATE_PERMISSIONS'
  INSTALLED=$(state_value version)
  KIND=$(state_value variant)
  [[ "$INSTALLED" =~ $version_pattern ]] || die 'INVALID_RELEASE_VERSION'
  case "$KIND" in bundled|external) ;; *) die 'INSTALLER_STATE_INVALID' ;; esac
  if use_installed "$INSTALLED" "$KIND"; then
    [ "$(state_value schema)" = 2 ] || die 'INSTALLER_STATE_INVALID'
    MODE=agent-reuse
    SELECTED_NODE=$(state_value node)
    if [ "$INSTALLED" = "$VERSION" ]; then
      [ "$(state_value packageHash)" = "$PAYLOAD_SHA" ] || die 'EXISTING_PACKAGE_MISMATCH'
    fi
    if [ "$KIND" = bundled ]; then
      INSTALLED_DIR="$BASE/versions/$INSTALLED-bundled"
      [ "$SELECTED_NODE" = "$INSTALLED_DIR/runtime/node" ] && [ ! -L "$INSTALLED_DIR" ] && [ ! -L "$INSTALLED_DIR/runtime" ] && [ ! -L "$SELECTED_NODE" ] || die 'INSTALLER_STATE_INVALID'
      NODE_SHA=$(state_value nodeHash)
      [[ "$NODE_SHA" =~ ^[a-f0-9]{64}$ ]] && [ "$(file_hash "$SELECTED_NODE")" = "$NODE_SHA" ] || die 'BUNDLED_NODE_HASH_MISMATCH'
      if [ "$INSTALLED" = "$VERSION" ]; then [ "$NODE_SHA" = "$RUNTIME_SHA" ] || die 'BUNDLED_NODE_HASH_MISMATCH'; fi
    fi
  fi
fi
PAYLOAD=
if [ "$MODE" = agent-install ]; then
  if [ "$VARIANT" = external ]; then SELECTED_NODE=$(command -v node || true); check_node; fi
  printf 'TeamSight: downloading %s %s over HTTPS.\n' "$VERSION" "$VARIANT" >&2
  /usr/bin/curl --disable --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 10 --max-time 300 "${CURL_ARGS[@]+"${CURL_ARGS[@]}"}" --output "$TEMP/package.tar.gz" "$URL" || die 'DOWNLOAD_FAILED'
  [ "$(file_hash "$TEMP/package.tar.gz")" = "$EXPECTED" ] || die 'ARCHIVE_HASH_MISMATCH'
  /usr/bin/tar -xzf "$TEMP/package.tar.gz" -C "$TEMP" || die 'ARCHIVE_EXTRACTION_FAILED'
  PAYLOAD="$TEMP/teamsight-mcp-darwin-arm64-$VARIANT"
  [ -d "$PAYLOAD" ] && [ ! -L "$PAYLOAD" ] || die 'ARCHIVE_LAYOUT_INVALID'
  [ "$(file_hash "$PAYLOAD/checksums.json")" = "$PAYLOAD_SHA" ] || die 'PAYLOAD_HASH_MISMATCH'
  if [ "$VARIANT" = bundled ]; then
    SELECTED_NODE="$PAYLOAD/runtime/node"
    [ ! -L "$PAYLOAD/runtime" ] && [ ! -L "$SELECTED_NODE" ] && [ "$(file_hash "$SELECTED_NODE")" = "$RUNTIME_SHA" ] || die 'BUNDLED_NODE_HASH_MISMATCH'
  fi
fi
check_node
/bin/cat > "$TEMP/installer.cjs" <<'__TEAMSIGHT_AGENT_JS__'
@INSTALLER_JS@
__TEAMSIGHT_AGENT_JS__
"$SELECTED_NODE" "$TEMP/installer.cjs" "$MODE" "$BASE" "$BASE" "$PAYLOAD" "$SELECTED_NODE" "$VERSION" "$VARIANT" "$TEST_FLAG" "$PORT" &
CHILD_PID=$!
wait "$CHILD_PID"
