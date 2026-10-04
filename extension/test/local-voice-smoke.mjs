// Offline load check. Does not start a microphone or claim a successful voice call.
import fs from 'node:fs';
import vm from 'node:vm';
const context = vm.createContext({
  window: { __tacetVoiceResources: { libsampleratePath: 'chrome-extension://test/vendor/libsamplerate.worklet.js' } },
  navigator: { platform: 'MacIntel', userAgent: 'Chrome' }, document: {},
  DOMException, TextEncoder, TextDecoder, URL, console, setTimeout, clearTimeout,
});
vm.runInContext(fs.readFileSync(new URL('../vendor/elevenlabs-client.js', import.meta.url), 'utf8'), context);
if (typeof context.window.ElevenLabsClient?.Conversation.startSession !== 'function') {
  throw new Error('Packaged voice SDK entrypoint is missing');
}
console.log('PASS: local SDK evaluates and exposes Conversation.startSession to the companion.');
