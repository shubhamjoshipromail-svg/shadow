#!/usr/bin/env bash
# Fetch Chrome for Testing (an unbranded Chromium) and print its binary path on stdout.
#
# Official Chrome 137+ ignores --load-extension, so an unpacked extension cannot be
# loaded there. Chrome for Testing still honours it, which is what the acceptance
# harness needs. Nothing is written inside the repository.
#
#   CHROME="$(bash extension/test/get-chrome.sh)" node extension/test/run.mjs
set -euo pipefail

dir="${TACET_CFT_DIR:-/tmp/tacet-cft}"
bin="$dir/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"

if [[ -x "$bin" ]]; then
  echo "$bin"
  exit 0
fi

url="$(curl -fsSL "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const d=j.channels.Stable.downloads.chrome.find(x=>x.platform==='mac-arm64');process.stdout.write(d.url)})")"

mkdir -p "$dir"
echo "downloading $url" >&2
curl -fL "$url" -o "$dir/cft.zip"
rm -rf "$dir/chrome-mac-arm64"
unzip -q "$dir/cft.zip" -d "$dir"
rm -f "$dir/cft.zip"

if [[ ! -x "$bin" ]]; then
  echo "get-chrome: download finished but $bin is missing" >&2
  exit 1
fi
echo "$bin"
