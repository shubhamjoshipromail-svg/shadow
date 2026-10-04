#!/usr/bin/env bash
# Sync the core companion/observer; voice uses the checked-in SDK and local worklets.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python3 "$here/sync-vendor.py"
