#!/usr/bin/env bash

set -e
cd "$(dirname "$0")"
exec ./scripts/install-relay-demo.sh "$@"

