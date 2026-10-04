#!/usr/bin/env bash
# Copy the companion (capture.js) and generic observer (observe.js) that Tacet injects
# from Shadow Core into ./vendor/. Run this after Shadow Core changes; the extension
# bundles these files. The companion's voice CDN import still needs local bundling
# before a Chrome Web Store submission; see store/listing.md.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/.." && pwd)"
src="$repo/backend/shadow/static"
dst="$here/vendor"

for f in capture.js observe.js; do
  if [[ ! -f "$src/$f" ]]; then
    echo "sync: missing $src/$f" >&2
    exit 1
  fi
done

mkdir -p "$dst"
cp "$src/capture.js" "$dst/capture.js"
cp "$src/observe.js" "$dst/observe.js"
echo "sync: vendor/capture.js vendor/observe.js updated from $src"
