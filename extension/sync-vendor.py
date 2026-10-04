"""Sync companion sources, adapting voice to the checked-in local SDK/worklets."""
from pathlib import Path
root = Path(__file__).resolve().parent
source = (root.parent / 'backend/shadow/static/capture.js').read_text()
def replace_once(old, new):
    global source
    if source.count(old) != 1:
        raise RuntimeError(f'Companion changed: expected exactly one {old!r}; review voice integration')
    source = source.replace(old, new)
replace_once('  var EL_CDN = "https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.26.0/+esm";\n', '')
replace_once('import(EL_CDN)', 'Promise.resolve(window.ElevenLabsClient)')
replace_once('        agentId: agentId,', '        agentId: agentId,\n        libsampleratePath: window.__tacetVoiceResources.libsampleratePath,\n        workletPaths: window.__tacetVoiceResources.workletPaths,')
(root / 'vendor/capture.js').write_text(source)
(root / 'vendor/observe.js').write_bytes((root.parent / 'backend/shadow/static/observe.js').read_bytes())
print('Synced companion and observer with local voice SDK integration.')
