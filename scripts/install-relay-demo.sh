#!/usr/bin/env bash

set -Eeuo pipefail

RELAY_NAME="${RELAY_MCP_NAME:-relay}"
RELAY_URL="${RELAY_MCP_URL:-https://relay-production-2026.opompm841218.chatgpt.site/api/mcp}"
WORKSPACE_NAME="${RELAY_WORKSPACE_NAME:-RoamTogether Development}"
WORKSPACE_ID="${RELAY_WORKSPACE_ID:-relay-production}"
LAUNCH_CODEX=1
INSTALL_CODEX=1
TEMP_INSTALLER=""

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
  unset member_token 2>/dev/null || true
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

step "Reading the Relay member token"
if [ -n "${RELAY_MCP_TOKEN:-}" ]; then
  member_token="$RELAY_MCP_TOKEN"
  printf 'Using RELAY_MCP_TOKEN already present in this Terminal.\n'
else
  printf 'Paste the Member token from the Workspace administrator, then press Enter.\n'
  printf 'The token will stay hidden: '
  if [ -r /dev/tty ]; then
    IFS= read -r -s member_token </dev/tty
  else
    IFS= read -r -s member_token
  fi
  printf '\n'
fi

[ -n "${member_token:-}" ] || fail "Member token cannot be empty."
export RELAY_MCP_TOKEN="$member_token"

if [ "$(uname -s)" = "Darwin" ] && command -v launchctl >/dev/null 2>&1; then
  launchctl setenv RELAY_MCP_TOKEN "$RELAY_MCP_TOKEN"
  printf 'Configured the current macOS login session for the Codex App.\n'
else
  printf 'Linux note: the token is available to Codex launched by this installer only.\n'
fi

step "Registering Relay MCP in Codex"
if codex mcp get "$RELAY_NAME" >/dev/null 2>&1; then
  codex mcp remove "$RELAY_NAME" >/dev/null
fi

codex mcp add "$RELAY_NAME" \
  --url "$RELAY_URL" \
  --bearer-token-env-var RELAY_MCP_TOKEN

step "Verifying the saved MCP configuration"
codex mcp get "$RELAY_NAME" --json

cat <<EOF

Relay Demo setup is complete.

Workspace name: $WORKSPACE_NAME
Workspace ID:   $WORKSPACE_ID
MCP server:     $RELAY_URL

In Codex, send this first message:
  請使用 Relay MCP 的 relay_get_workspace，回報 Workspace name 與 Workspace ID。

If this is your first Codex launch, choose "Sign in with ChatGPT" when prompted.
To remove the demo setup later:
  codex mcp remove $RELAY_NAME
  launchctl unsetenv RELAY_MCP_TOKEN   # macOS only
EOF

if [ "$LAUNCH_CODEX" -eq 1 ]; then
  step "Starting Codex"
  exec codex
fi

