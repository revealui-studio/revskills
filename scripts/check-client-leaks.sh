#!/usr/bin/env bash
# Private dictionaries are supplied as a file to this trusted scanner.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/check-client-leaks.mts" "$@"
