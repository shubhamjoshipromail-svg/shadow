"""Render vo.json lines with ElevenLabs TTS into out/vo/<id>.mp3 (key from backend/.env; never printed).

    python3 design/demo/tts.py            # missing lines only
    python3 design/demo/tts.py N05 M01    # re-render these
"""
import json, pathlib, sys, urllib.request, urllib.error

D = pathlib.Path(__file__).resolve().parent
ROOT = D.parents[1]
KEY = next(l.split("=", 1)[1].strip().strip('"\'') for l in (ROOT / "backend/.env").read_text().splitlines()
           if l.startswith("ELEVENLABS_API_KEY="))
VO = json.loads((D / "vo.json").read_text())
OUT = D / "out/vo"; OUT.mkdir(parents=True, exist_ok=True)
MODELS = ["eleven_v4", "eleven_v3"]


def tts(text: str, voice: str) -> bytes:
    err = ""
    for model in MODELS:
        body = json.dumps({"text": text, "model_id": model,
                           "voice_settings": {"stability": 0.5, "similarity_boost": 0.8}}).encode()
        req = urllib.request.Request(f"https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_192", body,
                                     {"xi-api-key": KEY, "content-type": "application/json", "accept": "audio/mpeg"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                print(f"   model {model}")
                return r.read()
        except urllib.error.HTTPError as e:
            err = f"{model}: {e.code} {e.read()[:200]!r}"
    raise SystemExit(err)


only = set(sys.argv[1:])
for line in VO["lines"]:
    f = OUT / f"{line['id']}.mp3"
    if (only and line["id"] not in only) or (not only and f.exists()):
        continue
    print(line["id"], line["text"][:60])
    f.write_bytes(tts(line["text"], VO["voices"][line["voice"]]))
