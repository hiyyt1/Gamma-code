#!/usr/bin/env bash
# Isolated OS-boundary tests, not booted-systemd acceptance tests.
set -euo pipefail
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BUN_TEST_BIN="$(command -v bun)"
if [ "$#" -eq 0 ]; then set -- 24.04 26.04; fi
for version in "$@"; do
  case "$version" in
    24.04|26.04) ;;
    *) echo 'Supported test images: 24.04, 26.04' >&2; exit 2 ;;
  esac
  docker run --rm \
    -v "$TEST_DIR/..:/deploy:ro" \
    -v "$BUN_TEST_BIN:/usr/local/bin/bun:ro" \
    -w /deploy/installer "ubuntu:$version" sh -c '
      timeout 120 apt-get -o Acquire::Retries=0 -o Acquire::http::Timeout=20 update -qq &&
      timeout 180 apt-get -o Acquire::Retries=0 -o Acquire::http::Timeout=20 install -y -qq python3 git ca-certificates >/dev/null &&
      useradd -m gamma-test &&
      runuser -u gamma-test -- python3 -B -m unittest test_installer test_provider_config test_transport
    '
done
