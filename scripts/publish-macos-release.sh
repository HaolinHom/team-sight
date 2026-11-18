#!/bin/bash
set -euo pipefail
TAG=$1
COMMIT=$2
ASSETS=$3
[[ "$TAG" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ && "$COMMIT" =~ ^[a-f0-9]{40}$ ]]
[[ "$GH_REPO" = HaolinHom/team-sight ]]
VERSION=${TAG#v}
NAMES=("teamsight-mcp-$VERSION-darwin-arm64-bundled.tar.gz" "teamsight-mcp-$VERSION-darwin-arm64-external.tar.gz" SHA256SUMS-darwin-arm64.txt)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
(cd "$ASSETS" && shasum -a 256 -c SHA256SUMS-darwin-arm64.txt)
API="repos/$GH_REPO/git"
if ! gh api "$API/ref/tags/$TAG" > "$TMP/tag.json"; then
  gh api --method POST "$API/refs" -f "ref=refs/tags/$TAG" -f "sha=$COMMIT" > "$TMP/tag.json"
fi
jq -e --arg sha "$COMMIT" '.object.type == "commit" and .object.sha == $sha' "$TMP/tag.json" >/dev/null
if ! gh release view "$TAG" --json isDraft,assets > "$TMP/release.json"; then
  gh release create "$TAG" --verify-tag --draft --title "TeamSight MCP $VERSION (macOS arm64)" --notes-file "$ASSETS/release-notes.md"
  gh release view "$TAG" --json isDraft,assets > "$TMP/release.json"
fi
if jq -e '.isDraft' "$TMP/release.json" >/dev/null; then
  for NAME in "${NAMES[@]}"; do
    if ! jq -e --arg name "$NAME" '.assets | any(.name == $name)' "$TMP/release.json" >/dev/null; then
      gh release upload "$TAG" "$ASSETS/$NAME"
    fi
  done
  for NAME in "${NAMES[@]}"; do
    gh release download "$TAG" --pattern "$NAME" --dir "$TMP"
    cmp "$ASSETS/$NAME" "$TMP/$NAME"
  done
  gh release edit "$TAG" --draft=false --latest
fi
for NAME in "${NAMES[@]}"; do
  curl --disable -fsSL --proto '=https' --proto-redir '=https' --retry 4 --connect-timeout 10 --max-time 300 \
    "https://github.com/$GH_REPO/releases/download/$TAG/$NAME" -o "$TMP/public-$NAME"
  cmp "$ASSETS/$NAME" "$TMP/public-$NAME"
done
