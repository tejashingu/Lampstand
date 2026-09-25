#!/usr/bin/env bash
# Dev launcher: relaunches itself under sudo (needed for apt/systemctl/chown/etc.)
# and runs the Electron app with --no-sandbox, which Chromium requires when
# executing as root.
set -e

cd "$(dirname "$0")/.."

if [ "$EUID" -ne 0 ]; then
  echo "Lampstand needs root privileges (apt, systemctl, chown, usermod, ...)."
  exec sudo -E "$0" "$@"
fi

if [ ! -d node_modules/electron ]; then
  echo "Dependencies not installed yet. Run 'npm install' first (as your normal user, not root)."
  exit 1
fi

exec ./node_modules/.bin/electron . --no-sandbox "$@"
