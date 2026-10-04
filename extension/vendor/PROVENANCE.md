# Packaged voice dependencies

- `elevenlabs-client.js`: official `@elevenlabs/client` 1.26.0 `dist/lib.iife.js`,
  copied from the installed console dependency. Its libsamplerate CDN default is
  replaced with `window.__tacetVoiceResources.libsampleratePath`; source-map reference
  removed; explicit `window.ElevenLabsClient` export appended for MAIN-world injection.
- `audioConcatProcessor.js` and `rawAudioProcessor.js`: that SDK's `worklets/` files.
- `libsamplerate.worklet.js`: official `@alexanderolsen/libsamplerate-js` 2.1.2 npm
  tarball, unchanged. Tarball npm shasum: `e1d029bf4f9a133d8587528189e82d110b8f5bd2`.
  Contains the resampler's WASM inline, rather than fetching a remote binary.
- SDK, LiveKit and libsamplerate license files accompany the package.

The web companion retains its web CDN import. `../sync-vendor.py` transforms the
extension copy only and refuses to proceed if its expected integration points change.
Upgrades require inspecting executable download paths again, preserving licenses,
and rerunning `../package.py` and `../test/local-voice-smoke.mjs`.
