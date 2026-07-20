#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ROOT_DIR/plugins/relay-shared-workspace/.codex-plugin/plugin.json" | head -n 1)"
VERSION="${VERSION:-unknown}"
SAFE_VERSION="$(printf '%s' "$VERSION" | tr -cs 'A-Za-z0-9._-' '-')"
OUTPUT="${1:-$ROOT_DIR/relay-shared-workspace-plugin-$SAFE_VERSION.tar.gz}"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/relay-plugin-package.XXXXXX")"

cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT INT TERM

mkdir -p "$STAGE/.agents/plugins" "$STAGE/plugins" "$STAGE/scripts"
cp "$ROOT_DIR/.agents/plugins/marketplace.json" "$STAGE/.agents/plugins/marketplace.json"
cp -R "$ROOT_DIR/plugins/relay-shared-workspace" "$STAGE/plugins/relay-shared-workspace"
cp "$ROOT_DIR/plugins/relay-shared-workspace/README.md" "$STAGE/README.md"
cp "$ROOT_DIR/INSTALL_RELAY_PLUGIN.command" "$STAGE/INSTALL_RELAY_PLUGIN.command"
cp "$ROOT_DIR/scripts/install-relay-plugin.sh" "$STAGE/scripts/install-relay-plugin.sh"
chmod +x "$STAGE/INSTALL_RELAY_PLUGIN.command" "$STAGE/scripts/install-relay-plugin.sh"

tar -C "$STAGE" -czf "$OUTPUT" .
printf '%s\n' "$OUTPUT"
