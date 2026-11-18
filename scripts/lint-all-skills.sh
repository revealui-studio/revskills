#!/usr/bin/env bash
# Portable metadata, existing content rules and command-link validation.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/validate-metadata.mts" skills "$SCRIPT_DIR/.." "$@"
