#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_NAME="relay-shared-workspace"
MARKETPLACE_NAME="relay-build-week"
PLUGIN_DIR="$ROOT_DIR/plugins/$PLUGIN_NAME"
MARKETPLACE_FILE="$ROOT_DIR/.agents/plugins/marketplace.json"
MCP_URL="https://relay-production-2026.opompm841218.chatgpt.site/api/mcp?member=Codex%20Plugin"
CHECK_ONLY=0
SKIP_HANDSHAKE=0
TEMP_RESPONSE=""

usage() {
  cat <<'EOF'
Relay Shared Workspace plugin installer

Usage:
  ./INSTALL_RELAY_PLUGIN.command [--check-only] [--skip-handshake]

Options:
  --check-only  Validate the package and hosted MCP endpoint without installing.
  --skip-handshake  Skip only the live MCP check when a firewall blocks it.
  -h, --help    Show this help.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --check-only) CHECK_ONLY=1 ;;
    --skip-handshake) SKIP_HANDSHAKE=1 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

cleanup() {
  if [ -n "$TEMP_RESPONSE" ] && [ -f "$TEMP_RESPONSE" ]; then rm -f "$TEMP_RESPONSE"; fi
}
trap cleanup EXIT INT TERM

fail() {
  printf '\nRelay plugin setup failed: %s\n' "$1" >&2
  exit 1
}

for required in \
  "$MARKETPLACE_FILE" \
  "$PLUGIN_DIR/.codex-plugin/plugin.json" \
  "$PLUGIN_DIR/.mcp.json" \
  "$PLUGIN_DIR/skills/relay-workspace/SKILL.md" \
  "$PLUGIN_DIR/assets/relay-shared-workspace-icon.png"; do
  [ -f "$required" ] || fail "Required package file is missing: $required"
done

command -v curl >/dev/null 2>&1 || fail "curl is required to verify the Relay MCP endpoint."

grep -q '"name"[[:space:]]*:[[:space:]]*"relay-build-week"' "$MARKETPLACE_FILE" || fail "Marketplace name is invalid."
grep -q '"name"[[:space:]]*:[[:space:]]*"relay-shared-workspace"' "$PLUGIN_DIR/.codex-plugin/plugin.json" || fail "Plugin manifest name is invalid."
grep -q '"mcpServers"[[:space:]]*:[[:space:]]*"\./\.mcp\.json"' "$PLUGIN_DIR/.codex-plugin/plugin.json" || fail "Plugin manifest does not bundle .mcp.json."
grep -q '"type"[[:space:]]*:[[:space:]]*"http"' "$PLUGIN_DIR/.mcp.json" || fail "Relay MCP transport is invalid."

if [ "$SKIP_HANDSHAKE" -eq 0 ]; then
  TEMP_RESPONSE="$(mktemp "${TMPDIR:-/tmp}/relay-plugin-handshake.XXXXXX")"
  status="$(curl --silent --show-error \
    --output "$TEMP_RESPONSE" \
    --write-out '%{http_code}' \
    --request POST "$MCP_URL" \
    --header 'Accept: application/json, text/event-stream' \
    --header 'Content-Type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"relay-plugin-installer","version":"1.0"}}}')"
  [ "$status" = "200" ] || fail "Hosted Relay MCP returned HTTP $status."
  grep -q '"protocolVersion"' "$TEMP_RESPONSE" || fail "Hosted Relay MCP did not return a valid initialize response."
fi

if [ "$SKIP_HANDSHAKE" -eq 1 ]; then
  printf 'Relay plugin package is valid; live MCP verification was skipped.\n'
else
  printf 'Relay plugin package and hosted MCP endpoint are valid.\n'
fi
if [ "$CHECK_ONLY" -eq 1 ]; then exit 0; fi

command -v codex >/dev/null 2>&1 || fail "Codex CLI is not installed. Install it from https://developers.openai.com/codex/cli/ and run this installer again."

if codex plugin marketplace list 2>/dev/null | grep -Fq "$ROOT_DIR"; then
  printf 'Relay marketplace is already registered.\n'
else
  codex plugin marketplace add "$ROOT_DIR"
fi

codex plugin add "$PLUGIN_NAME@$MARKETPLACE_NAME"

cat <<EOF

Relay Shared Workspace is installed.

1. Restart the ChatGPT desktop app or Codex CLI.
2. Start a new Codex task/session.
3. Send: Set up Relay and show available workspaces.
4. Open the Dashboard: https://relay-production-2026.opompm841218.chatgpt.site

The hosted Relay supplies D1, R2, embeddings, cache, and Dashboard storage.
RAG and Full Generation use the model already available to the user's Codex host.
EOF
