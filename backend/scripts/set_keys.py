"""Write API keys into backend/.env without echoing them. Leave a prompt empty to keep the current value."""

import sys
from getpass import getpass
from pathlib import Path

ENV = Path(__file__).resolve().parent.parent / ".env"
KEYS = sys.argv[1:] or ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "ELEVENLABS_API_KEY"]  # or name the keys to set

lines = ENV.read_text().splitlines() if ENV.exists() else []
values = {}
for k in KEYS:
    v = getpass(f"{k} (hidden, Enter to skip): ").strip().strip('"').strip("'")
    if v:
        values[k] = v

out, seen = [], set()
for line in lines:
    k = line.split("=", 1)[0].strip()
    if k in values:
        out.append(f"{k}={values[k]}")
        seen.add(k)
    else:
        out.append(line)
for k, v in values.items():
    if k not in seen:
        out.append(f"{k}={v}")
ENV.write_text("\n".join(out) + "\n")
print("Saved:", ", ".join(f"{k} ({len(v)} chars)" for k, v in values.items()) or "nothing changed")
