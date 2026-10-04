# Extension submission package

Created `dist/tacet-extension-0.1.0.zip` (manifest at ZIP root).
Toolbar icons explicitly configured at 16/32/48; management/listing icon includes
128; popup uses the actual Tacet logo instead of the Mira initial.

Preserved voice by packaging ElevenLabs client 1.26.0 and libsamplerate 2.1.2
locally, including audio worklets and dependency licenses. The extension companion
uses the local SDK and extension resource URLs. Backend web companion unchanged.
`sync.sh` now applies a checked extension-only transform rather than reintroducing
the CDN import. Store draft and extension documentation updated.

Validation: `python3 extension/package.py` passed (22 packaged files, ZIP CRC,
manifest paths, PNG dimensions, JS syntax, absence of jsDelivr and old CDN import,
SDK injection order and local worklet wiring). `node extension/test/local-voice-smoke.mjs`
passed SDK evaluation and exported Conversation.startSession in an offline browser
stub. Original SDK test attempts lacked DOMException/navigator in the Node VM;
the final fixture supplies these browser globals.

These checks do not prove microphone permissions, audio worklet loading under
individual host CSPs, a real voice call, installed extension behavior, or store approval.
Before submission, perform the installed Chrome smoke test and verify the deployed
privacy-policy URL. No upload, deployment or Git push performed.
