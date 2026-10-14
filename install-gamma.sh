#!/usr/bin/env bash
# Gamma production installer. Requires the complete, reviewed repository checkout.
set -euo pipefail
set +x
INSTALLER_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v python3 >/dev/null 2>&1; then
  echo 'Gamma requires Python 3 (included in Ubuntu Server 24.04 / 26.04 LTS).' >&2
  exit 1
fi
exec python3 -B "$INSTALLER_DIR/deploy/installer/gamma_installer.py" "$@"
