"""Validate extension runtime files and produce the developer-portal ZIP."""
from pathlib import Path
import json, struct, subprocess, zipfile, hashlib
root = Path(__file__).resolve().parent
subprocess.run(['bash', str(root / 'sync.sh')], check=True)
manifest = json.loads((root / 'manifest.json').read_text())
files = [root / name for name in ('manifest.json', 'background.js', 'shared.js')]
for directory in ('popup', 'injected', 'vendor'):
    files.extend(sorted((root / directory).glob('*')))
files.extend(root / path for path in manifest['icons'].values())
assert len(files) == len(set(files))
for size, relative in manifest['icons'].items():
    data = (root / relative).read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    assert struct.unpack('>II', data[16:24]) == (int(size), int(size))
for relative in manifest['action']['default_icon'].values():
    assert root / relative in files
for group in manifest['web_accessible_resources']:
    for relative in group['resources']:
        assert root / relative in files
assert root / manifest['background']['service_worker'] in files
assert root / manifest['action']['default_popup'] in files
for path in files:
    assert path.is_file(), path
    if path.suffix == '.js':
        subprocess.run(['node', '--check', str(path)], check=True, capture_output=True)
        text = path.read_text()
        assert 'cdn.jsdelivr.net' not in text, path
        assert 'import(EL_CDN)' not in text, path
sdk = (root / 'vendor/elevenlabs-client.js').read_text()
assert 'window.__tacetVoiceResources.libsampleratePath' in sdk
companion = (root / 'vendor/capture.js').read_text()
assert 'Promise.resolve(window.ElevenLabsClient)' in companion
assert 'workletPaths: window.__tacetVoiceResources.workletPaths' in companion
worker = (root / 'background.js').read_text()
assert worker.index('"vendor/elevenlabs-client.js"') < worker.index('"vendor/capture.js"')
output = root.parent / 'dist' / f"tacet-extension-{manifest['version']}.zip"
output.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in files:
        archive.write(path, path.relative_to(root).as_posix())
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    assert 'manifest.json' in archive.namelist()
    assert len(archive.namelist()) == len(files)
print(f'Validated {len(files)} runtime files, icon sizes, JS syntax and local voice wiring.')
print(output)
print(f'{output.stat().st_size:,} bytes; SHA-256 {hashlib.sha256(output.read_bytes()).hexdigest()}')
