#!/usr/bin/env bash
set -euo pipefail

# Beads (bd) wrapper for reliable invocation across environments.
# Tries PATH, then common install locations.

if command -v bd >/dev/null 2>&1; then
  exec bd "$@"
fi

if [[ -x "$HOME/go/bin/bd" ]]; then
  exec "$HOME/go/bin/bd" "$@"
fi

if [[ -x "/usr/local/bin/bd" ]]; then
  exec "/usr/local/bin/bd" "$@"
fi

echo "Error: bd not found in PATH, $HOME/go/bin, or /usr/local/bin." >&2
echo "Install: curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/install.sh | bash" >&2
exit 127
