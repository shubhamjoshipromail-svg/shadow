"""ElevenLabs Music bed for the demo cut -> out/music.mp3 (key from backend/.env; never printed)."""
import json, pathlib, urllib.request

D = pathlib.Path(__file__).resolve().parent
KEY = next(l.split("=", 1)[1].strip().strip('"\'') for l in (D.parents[1] / "backend/.env").read_text().splitlines()
           if l.startswith("ELEVENLABS_API_KEY="))
PROMPT = ("Restrained modern minimal instrumental for a three-minute product demo: soft felt piano, warm analog synth pad, "
          "a light steady pulse that gives forward motion, confident and curious, spacious, no vocals, no big drum fills; "
          "quiet opening, gently builds through the middle, a lift near two and a half minutes, calm warm resolve at the end.")
req = urllib.request.Request("https://api.elevenlabs.io/v1/music", json.dumps({"prompt": PROMPT, "music_length_ms": 180000}).encode(),
                             {"xi-api-key": KEY, "content-type": "application/json"})
out = D / "out/music.mp3"; out.parent.mkdir(parents=True, exist_ok=True)
with urllib.request.urlopen(req, timeout=600) as r:
    out.write_bytes(r.read())
print("wrote", out, out.stat().st_size)
