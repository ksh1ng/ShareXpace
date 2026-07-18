#!/usr/bin/env bash

set -Eeuo pipefail

RELAY_NAME="${RELAY_MCP_NAME:-relay}"
RELAY_URL="${RELAY_MCP_URL:-https://relay-production-2026.opompm841218.chatgpt.site/api/mcp}"
WORKSPACE_NAME="${RELAY_WORKSPACE_NAME:-RoamTogether Development}"
WORKSPACE_ID="${RELAY_WORKSPACE_ID:-relay-production}"
LAUNCH_CODEX=1
INSTALL_CODEX=1
TEMP_INSTALLER=""
TEMP_HANDSHAKE=""

usage() {
  cat <<'EOF'
Relay Demo one-click installer

Usage:
  ./scripts/install-relay-demo.sh [--no-launch] [--skip-codex-install]

Options:
  --no-launch           Configure everything but do not start Codex.
  --skip-codex-install  Keep the currently installed Codex CLI version.
  -h, --help            Show this help.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-launch) LAUNCH_CODEX=0 ;;
    --skip-codex-install) INSTALL_CODEX=0 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

cleanup() {
  if [ -n "$TEMP_INSTALLER" ] && [ -f "$TEMP_INSTALLER" ]; then
    rm -f "$TEMP_INSTALLER"
  fi
  if [ -n "$TEMP_HANDSHAKE" ] && [ -f "$TEMP_HANDSHAKE" ]; then
    rm -f "$TEMP_HANDSHAKE"
  fi
}
trap cleanup EXIT INT TERM

step() {
  printf '\n\033[1;36m==> %s\033[0m\n' "$1"
}

fail() {
  printf '\nRelay setup failed: %s\n' "$1" >&2
  exit 1
}

command -v curl >/dev/null 2>&1 || fail "curl is required."

case "$(uname -s)" in
  Darwin|Linux) ;;
  *) fail "This installer currently supports macOS and Linux." ;;
esac

step "Installing or updating Codex CLI"
if [ "$INSTALL_CODEX" -eq 1 ]; then
  TEMP_INSTALLER="$(mktemp "${TMPDIR:-/tmp}/codex-install.XXXXXX")"
  curl -fsSL https://chatgpt.com/codex/install.sh -o "$TEMP_INSTALLER"
  /bin/sh "$TEMP_INSTALLER"
fi

export PATH="$HOME/.local/bin:$PATH"
command -v codex >/dev/null 2>&1 || fail "Codex was not found after installation. Open a new Terminal and run this installer again."
codex --version

step "Joining the Relay workspace"
workspace_id="${RELAY_WORKSPACE_ID:-$WORKSPACE_ID}"
member_name="${RELAY_MEMBER_NAME:-DemoMember}"
if [ -r /dev/tty ]; then
  printf 'Workspace ID [%s]: ' "$workspace_id"
  IFS= read -r entered_workspace_id </dev/tty
  workspace_id="${entered_workspace_id:-$workspace_id}"
  printf 'Display name [%s]: ' "$member_name"
  IFS= read -r entered_member_name </dev/tty
  member_name="${entered_member_name:-$member_name}"
fi

case "$workspace_id" in *[!a-zA-Z0-9_.-]*|'') fail "Workspace ID may contain only letters, numbers, dots, underscores, and hyphens." ;; esac
case "$member_name" in *[!a-zA-Z0-9_.-]*|'') fail "Display name may contain only letters, numbers, dots, underscores, and hyphens." ;; esac
connection_url="${RELAY_URL}?workspace_id=${workspace_id}&member=${member_name}"

# Remove the credential left by installer versions that predated Workspace-ID join mode.
unset RELAY_MCP_TOKEN 2>/dev/null || true
if [ "$(uname -s)" = "Darwin" ] && command -v launchctl >/dev/null 2>&1; then
  launchctl unsetenv RELAY_MCP_TOKEN >/dev/null 2>&1 || true
fi

step "Registering Relay MCP in Codex"
if codex mcp get "$RELAY_NAME" >/dev/null 2>&1; then
  codex mcp remove "$RELAY_NAME" >/dev/null
fi

codex mcp add "$RELAY_NAME" \
  --url "$connection_url"

step "Verifying the saved MCP configuration"
codex mcp get "$RELAY_NAME" --json

step "Testing the MCP handshake"
TEMP_HANDSHAKE="$(mktemp "${TMPDIR:-/tmp}/relay-handshake.XXXXXX")"
handshake_status="$(curl --silent --show-error \
  --output "$TEMP_HANDSHAKE" \
  --write-out '%{http_code}' \
  --request POST "$connection_url" \
  --header 'Accept: application/json, text/event-stream' \
  --header 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"relay-demo-installer","version":"1.0"}}}')"

if [ "$handshake_status" != "200" ] || ! grep -q '"protocolVersion"' "$TEMP_HANDSHAKE"; then
  fail "Relay MCP handshake returned HTTP $handshake_status. Confirm the Production URL and Workspace ID, then run the installer again."
fi
printf 'Relay MCP handshake succeeded (HTTP 200).\n'

cat <<EOF

Relay Demo setup is complete.

Workspace name: $WORKSPACE_NAME
Workspace ID:   $workspace_id
Member label:   $member_name
MCP server:     $connection_url

In Codex, send this first message:
  請使用 Relay MCP 的 relay_get_workspace，回報 Workspace name 與 Workspace ID。

If this is your first Codex launch, choose "Sign in with ChatGPT" when prompted.
To remove the demo setup later:
  codex mcp remove $RELAY_NAME
EOF

if [ "$LAUNCH_CODEX" -eq 1 ]; then
  step "Starting Codex"
  exec codex
fi
