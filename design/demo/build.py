"""Tacet demo cut: today's screen recordings + Shubham's selfie + AI b-roll -> out/tacet-demo.mp4 (1920x1080, 30 fps).

    python3 design/demo/build.py            # full build
    python3 design/demo/build.py --shots 7  # re-render only these shots, then re-join

Sources are the real recordings on ~/Desktop (Screen Recording 2026-10-04 at H.MM.SS.mov) and ~/Downloads/IMG_2345.MOV.
Narration and Mira's re-voiced questions come from tts.py (out/vo), music from music.py, word timings from ElevenLabs
Scribe (out/stt). Everything the expert or new hire says is their own recorded voice.
"""
from __future__ import annotations

import base64, hashlib, html, json, pathlib, subprocess, sys, urllib.request

D = pathlib.Path(__file__).resolve().parent
ROOT = D.parents[1]
OUT = D / "out"
FF = str(ROOT / "design/video/node_modules/ffmpeg-static/ffmpeg")
DESK = pathlib.Path.home() / "Desktop"
FACE = pathlib.Path.home() / "Downloads/IMG_2345.MOV"
PAPER, INK, MUTED, MOSS, BRICK = "#f4f1ea", "#1d1b16", "#6f6a5e", "#4f6b3a", "#9b3b2b"
W, H, FPS = 1920, 1080, 30
WIN = (80, 60, 1760, 880)  # where screen recordings sit
FONTS = ("<link href='https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500"
         "&family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;1,6..72,300;1,6..72,400&display=block' rel='stylesheet'>")


def rec(name: str) -> str:
    return str(DESK / f"Screen Recording 2026-10-04 at {name}.mov")


def box(top: int = 172, left: int = 16, w: int = 2908) -> tuple[int, int, int, int]:
    return (left, top, w, w // 2)


WIDE = box(172, 70, 2800)           # Tacet / ERP tab without the sharing bar (window shadow at the bottom left out)
WIDE_BAR = box(284, 188, 2564)      # ERP tab while "Sharing this tab" bar is shown
BR = (1176, 696, 1740, 870)         # bottom-right: booking panel + Mira's bubble (inside the pink sharing border)
TR = (1180, 172, 1760, 880)         # top-right: booking panel + Mira's stop plate

ACT = {1: "01  Learn from an expert", 2: "02  Prove it", 3: "03  The Work Map", 4: "04  Teach a new hire", 5: "05  Any workflow"}

# kind, source, segments [(a, b)] in source seconds, speed, crop box, keep-audio ranges, vo [(id, offset)], act, xf in
SHOTS = [
    dict(kind="full", src=str(ROOT / "design/film/assets/flow-desk-friday.mp4"), segs=[(0, 6.9)], vo=[("N01", 0.35)], xf=0),
    dict(kind="full", src=str(ROOT / "design/film/assets/flow-desk-monday.mp4"), segs=[(0.6, 7.6)], vo=[("N02", 0.2)], xf=0.6),
    dict(kind="face", src=str(FACE), segs=[(2.55, 3.3), (4.25, 12.95), (23.0, 32.05)], audio=True, xf=0.6, who="face"),
    dict(kind="card", card="title", dur=4.6, vo=[("N03", 0.45)], xf=0.5),
    dict(kind="screen", src=rec("2.16.38"), segs=[(11.0, 19.2)], box=WIDE, vo=[("N04", 0.2)], act=1, xf=0.5),
    dict(kind="screen", src=rec("2.26.29"), segs=[(45.5, 60.8)], speed=1.38, box=WIDE_BAR, vo=[("N05", 0.1)], act=1, xf=0.3),
    dict(kind="screen", src=rec("2.26.29"), segs=[(60.8, 76.4)], box=BR, audio=[(69.9, 76.4)], vo=[("M01", 0.45)], act=1,
         xf=0.25, who="sabine"),
    # the notebook showing that same question (static page, held while the narration explains the compile)
    dict(kind="screen", src=rec("2.24.55"), segs=[(81.1, 83.85)], speed=0.26, box=(700, 300, 2200, 1100), vo=[("N06", 0.2)],
         act=1, xf=0.3),
    dict(kind="screen", src=rec("2.26.29"), segs=[(95.7, 101.7), (106.2, 110.2)], box=BR, audio=[(106.2, 110.2)],
         vo=[("M02", 0.3)], act=1, xf=0.3, who="sabine"),
    dict(kind="screen", src=rec("2.39.22"), segs=[(4.5, 26.0)], speed=1.45, box=WIDE, vo=[("N07", 0.3)], act=2, xf=0.5),
    dict(kind="screen", src=rec("2.36.50"), segs=[(5.5, 19.0)], speed=1.55, box=WIDE, vo=[("N08", 0.3)], act=3, xf=0.5),
    dict(kind="screen", src=rec("2.36.50"), segs=[(58.6, 63.4)], box=WIDE, vo=[("N09", 0.2)], act=3, xf=0.3),
    dict(kind="screen", src=rec("2.36.50"), segs=[(84.0, 100.0)], speed=1.6, box=WIDE, act=3, xf=0.3),
    dict(kind="screen", src=rec("2.29.16"), segs=[(0.4, 4.2)], box=WIDE, vo=[("N10", 0.15)], act=4, xf=0.5),
    dict(kind="screen", src=rec("2.29.16"), segs=[(137.5, 148.2)], speed=1.7, box=WIDE, act=4, xf=0.3),
    dict(kind="screen", src=rec("2.29.16"), segs=[(148.2, 158.8)], box=TR, vo=[("M03", 0.35)], act=4, xf=0.25),
    dict(kind="screen", src=rec("2.29.16"), segs=[(186.9, 192.6)], box=WIDE, audio=[(186.9, 192.6)], act=4, xf=0.3, who="lena"),
    dict(kind="screen", src=rec("2.51.20"), segs=[(0.5, 45.0)], speed=3.9, box=WIDE, vo=[("N11", 0.2)], act=5, xf=0.5),
    dict(kind="screen", src=rec("2.51.20"), segs=[(45.0, 53.5)], box=(1180, 740, 1760, 880), act=5, xf=0.3),
    dict(kind="face", src=str(FACE), segs=[(46.95, 52.35), (53.95, 58.9), (59.1, 60.6)], audio=True, xf=0.6, who="face",
         quote=True),
    dict(kind="card", card="end", dur=6.5, xf=0.6),
]
SPEAKER = {"sabine": "Sabine · played by Shubham", "lena": "Lena · the new hire"}


def run(args: list[str]) -> None:
    subprocess.run(args, check=True)


def ff(*args: str) -> None:
    run([FF, "-y", "-loglevel", "error", *args])


def dur_of(path: str) -> float:
    out = subprocess.run([FF, "-hide_banner", "-i", path], capture_output=True, text=True).stderr
    h, m, s = out.split("Duration: ")[1].split(",")[0].split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


def shot_len(s: dict) -> float:
    if s["kind"] == "card":
        return s["dur"]
    return sum(b - a for a, b in s["segs"]) / s.get("speed", 1)


def src_to_shot(s: dict, t: float) -> float | None:
    """Source second -> second inside the shot (None if cut out)."""
    acc = 0.0
    for a, b in s["segs"]:
        if a <= t <= b:
            return (acc + t - a) / s.get("speed", 1)
        acc += b - a
    return None


# ------------------------------------------------------------------ html bits
def page(body: str, css: str = "") -> str:
    return (f"<!doctype html><html><head><meta charset=utf-8>{FONTS}<style>html,body{{margin:0;width:{W}px;height:{H}px;"
            f"background:transparent;overflow:hidden;-webkit-font-smoothing:antialiased}}*{{box-sizing:border-box}}{css}</style>"
            f"</head><body>{body}</body></html>")


FACE_CARD = (110, 90, 820, 900)       # where the selfie sits; its source crop drops the ceiling above him
# iPhone HLG (BT.2020) -> SDR BT.709, then drop the ceiling above him
FACE_CROP = ("zscale=tin=arib-std-b67:min=bt2020nc:pin=bt2020:t=linear:npl=203,format=gbrpf32le,zscale=p=bt709,"
             "tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,crop=2160:2240:0:1600")


def sprite(px: int) -> str:
    """First cell of the 2x2 Mira sprite sheet."""
    uri = "data:image/png;base64," + base64.b64encode((ROOT / "design/film/mira-sprite.png").read_bytes()).decode()
    return (f"<div style=\"width:{px}px;height:{px}px;background:url('{uri}') 0 0/200% 200% no-repeat;"
            f"margin-bottom:14px\"></div>")


def static_pngs() -> None:
    x, y, w, h = WIN
    bg = page(f"<div style='position:absolute;inset:0;background:{PAPER}'></div><div style='position:absolute;left:{x}px;top:{y}px;"
              f"width:{w}px;height:{h}px;border-radius:14px;background:#fff;box-shadow:0 22px 60px rgba(60,45,20,.16),0 2px 8px "
              f"rgba(60,45,20,.10)'></div>")
    mask = page(f"<div style='position:absolute;left:{x}px;top:{y}px;width:{w}px;height:{h}px;border-radius:14px;"
                f"box-shadow:0 0 0 1px rgba(40,30,15,.12),0 0 0 2600px {PAPER}'></div>")
    fx, fy, fw, fh = FACE_CARD
    face_bg = page(f"<div style='position:absolute;inset:0;background:{PAPER}'></div><div style='position:absolute;left:{fx}px;"
                   f"top:{fy}px;width:{fw}px;height:{fh}px;border-radius:18px;box-shadow:0 22px 60px rgba(60,45,20,.18)'></div>")
    face_mask = page(f"<div style='position:absolute;left:{fx}px;top:{fy}px;width:{fw}px;height:{fh}px;border-radius:18px;"
                     f"box-shadow:0 0 0 2600px {PAPER}'></div>")
    title = page(f"""<div class=c>{sprite(230)}<div class=w>Tacet</div>
      <div class=t>An apprentice that learns what the AI doesn't already know.</div>
      <div class=m>MIRA · THE APPRENTICE</div></div>""",
                 f"body{{background:{PAPER}}}.c{{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;"
                 f"justify-content:center}}img{{width:210px;margin-bottom:18px}}.w{{font:400 150px/1 Newsreader;color:{INK};"
                 f"letter-spacing:-3px}}.t{{font:300 40px/1.3 Newsreader;font-style:italic;color:{MUTED};margin-top:26px}}"
                 f".m{{font:500 16px 'IBM Plex Mono';letter-spacing:4px;color:{MOSS};margin-top:44px}}")
    end = page(f"""<div class=c>{sprite(170)}<div class=w>Tacet</div>
      <div class=t>What you say becomes a rule. What you do proves it.</div>
      <div class=u>tacet.up.railway.app</div>
      <div class=m>Built solo for HackNation × ElevenLabs · The AI Apprentice</div>
      <div class=e>ElevenLabs Agents (Eleven v4 Turbo) · Custom LLM · MCP · Scribe · Text to Speech · Music</div></div>""",
               f"body{{background:{PAPER}}}.c{{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;"
               f"justify-content:center}}img{{width:150px;margin-bottom:10px}}.w{{font:400 120px/1 Newsreader;color:{INK};"
               f"letter-spacing:-2px}}.t{{font:300 38px/1.3 Newsreader;font-style:italic;color:{INK};margin-top:22px}}"
               f".u{{font:500 30px 'IBM Plex Mono';color:{MOSS};margin-top:40px}}.m{{font:400 20px Geist;color:{MUTED};"
               f"margin-top:44px}}.e{{font:400 16px 'IBM Plex Mono';color:{MUTED};margin-top:12px;letter-spacing:.5px}}")
    jobs = [("bg", bg), ("mask", mask), ("face_bg", face_bg), ("face_mask", face_mask), ("card_title", title), ("card_end", end)]
    render([(str(OUT / "png" / f"{n}.png"), h_) for n, h_ in jobs])


def render(jobs: list[tuple[str, str]]) -> None:
    todo = [{"out": o, "html": h_} for o, h_ in jobs]
    p = OUT / "png" / "jobs.json"
    p.write_text(json.dumps(todo))
    run(["node", str(D / "render_png.mjs"), str(p)])


# ------------------------------------------------------------------ shots
def render_shot(i: int, s: dict) -> str:
    out = str(OUT / "shots" / f"{i:02d}.mp4")
    n = shot_len(s)
    enc = ["-c:v", "libx264", "-crf", "15", "-preset", "medium", "-pix_fmt", "yuv420p", "-r", str(FPS), "-an"]
    png = OUT / "png"
    if s["kind"] == "card":
        ff("-loop", "1", "-t", f"{n:.3f}", "-i", str(png / f"card_{s['card']}.png"), "-vf", f"fps={FPS},format=yuv420p", *enc, out)
        return out
    a0 = max(0.0, min(a for a, _ in s["segs"]) - 1)
    b1 = max(b for _, b in s["segs"]) + 1
    trims = "".join(f"[0:v]trim=start={a - a0:.3f}:end={b - a0:.3f},setpts=PTS-STARTPTS[s{k}];" for k, (a, b) in enumerate(s["segs"]))
    cat = "".join(f"[s{k}]" for k in range(len(s["segs"]))) + f"concat=n={len(s['segs'])}:v=1:a=0,setpts=PTS/{s.get('speed', 1)},fps={FPS}"
    if s["kind"] == "full":
        fc = f"{trims}{cat},scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}[v]"
        ff("-ss", f"{a0:.3f}", "-to", f"{b1:.3f}", "-i", s["src"], "-filter_complex", fc, "-map", "[v]", "-t", f"{n:.3f}", *enc, out)
    elif s["kind"] == "face":
        fx, fy, fw, fh = FACE_CARD
        fc = (f"{trims}{cat},{FACE_CROP},scale={fw}:{fh}:force_original_aspect_ratio=increase,crop={fw}:{fh}[f];"
              f"[1:v][f]overlay={fx}:{fy}[o];[o][2:v]overlay=0:0[v]")
        ff("-ss", f"{a0:.3f}", "-to", f"{b1:.3f}", "-i", s["src"], "-loop", "1", "-i", str(png / "face_bg.png"),
           "-loop", "1", "-i", str(png / "face_mask.png"), "-filter_complex", fc, "-map", "[v]", "-t", f"{n:.3f}", *enc, out)
    else:
        x, y, w, h = s["box"]
        wx, wy, ww, wh = WIN
        fc = (f"{trims}{cat},crop={w}:{h}:{x}:{y},scale={ww}:{wh}:flags=lanczos[f];"
              f"[1:v][f]overlay={wx}:{wy}[o];[o][2:v]overlay=0:0[v]")
        ff("-ss", f"{a0:.3f}", "-to", f"{b1:.3f}", "-i", s["src"], "-loop", "1", "-i", str(png / "bg.png"),
           "-loop", "1", "-i", str(png / "mask.png"), "-filter_complex", fc, "-map", "[v]", "-t", f"{n:.3f}", *enc, out)
    return out


def timeline() -> list[float]:
    starts, t = [], 0.0
    for i, s in enumerate(SHOTS):
        t = 0.0 if i == 0 else t - s["xf"]
        starts.append(t)
        t += shot_len(s)
    return starts


def join(starts: list[float]) -> float:
    ins, fc, prev, acc = [], "", "[0:v]", shot_len(SHOTS[0])
    for i in range(len(SHOTS)):
        ins += ["-i", str(OUT / "shots" / f"{i:02d}.mp4")]
    for i in range(1, len(SHOTS)):
        xf = max(SHOTS[i]["xf"], 0.04)
        fc += f"{prev}[{i}:v]xfade=transition=fade:duration={xf:.3f}:offset={starts[i]:.3f}[x{i}];"
        prev = f"[x{i}]"
    total = starts[-1] + shot_len(SHOTS[-1])
    fc += f"{prev}format=yuv420p[v]"
    ff(*ins, "-filter_complex", fc, "-map", "[v]", "-c:v", "libx264", "-crf", "15", "-preset", "medium", "-r", str(FPS),
       str(OUT / "base.mp4"))
    return total


# ------------------------------------------------------------------ words, captions, overlay
def stt(path: pathlib.Path) -> dict:
    cache = OUT / "stt" / (path.stem + ".vo.json")
    if not cache.exists():
        key = next(l.split("=", 1)[1].strip().strip('"\'') for l in (ROOT / "backend/.env").read_text().splitlines()
                   if l.startswith("ELEVENLABS_API_KEY="))
        bnd = "----tacet" + hashlib.md5(path.read_bytes()).hexdigest()
        body = (f"--{bnd}\r\nContent-Disposition: form-data; name=\"model_id\"\r\n\r\nscribe_v1\r\n--{bnd}\r\n"
                f"Content-Disposition: form-data; name=\"file\"; filename=\"{path.name}\"\r\nContent-Type: audio/mpeg\r\n\r\n").encode()
        body += path.read_bytes() + f"\r\n--{bnd}--\r\n".encode()
        req = urllib.request.Request("https://api.elevenlabs.io/v1/speech-to-text", body,
                                     {"xi-api-key": key, "content-type": f"multipart/form-data; boundary={bnd}"})
        with urllib.request.urlopen(req, timeout=300) as r:
            cache.write_bytes(r.read())
    return json.loads(cache.read_text())


FIX = {"Tasteit.": "Tacet.", "Tasteit": "Tacet", "Hopkins,": "Hopkins,", "John": "Johns", "CapEx,": "capex,", "CapEx": "capex",
       "four...": "four…", "24": "twenty-four"}


def words_for(i: int, s: dict, t0: float) -> list[dict]:
    """Timeline words spoken during shot i: narration, Mira and recorded voices."""
    out = []
    for vid, off in s.get("vo", []):
        who = "mira" if vid.startswith("M") else "narrator"
        for w in stt(OUT / "vo" / f"{vid}.mp3")["words"]:
            if w["type"] == "word":
                out.append(dict(t=t0 + off + w["start"], e=t0 + off + w["end"], w=w["text"], who=who))
    if s.get("audio"):
        name = "face" if s["kind"] == "face" else pathlib.Path(s["src"]).stem.split("at ")[-1].replace(".", "-")
        ranges = s["segs"] if s["audio"] is True else s["audio"]
        for w in json.loads((OUT / "stt" / f"{name}.json").read_text())["words"]:
            if w["type"] != "word" or not any(a <= w["start"] and w["end"] <= b + 0.05 for a, b in ranges):
                continue
            st, en = src_to_shot(s, w["start"]), src_to_shot(s, min(w["end"], max(b for a, b in ranges)))
            if st is None:
                continue
            out.append(dict(t=t0 + st, e=t0 + (en if en is not None else st + 0.3), w=FIX.get(w["text"], w["text"]),
                            who=s.get("who", "narrator")))
    return out


def cues(words: list[dict]) -> list[dict]:
    words = sorted(words, key=lambda w: w["t"])
    res, cur = [], []
    for w in words:
        if cur and (w["who"] != cur[-1]["who"] or w["t"] - cur[-1]["e"] > 0.7 or
                    len(" ".join(x["w"] for x in cur + [w])) > 58 or
                    (cur[-1]["w"][-1:] in ".?!" and len(" ".join(x["w"] for x in cur)) > 18)):
            res.append(cur); cur = []
        cur.append(w)
    if cur:
        res.append(cur)
    out = [dict(t=c[0]["t"] - 0.05, e=c[-1]["e"] + 0.35, who=c[0]["who"], text=" ".join(x["w"] for x in c)) for c in res]
    for a, b in zip(out, out[1:]):
        a["e"] = min(a["e"], b["t"])
    return out


CSS = f"""
.top{{position:absolute;left:80px;right:80px;top:20px;display:flex;justify-content:space-between;font:500 15px 'IBM Plex Mono';
 letter-spacing:2.5px;text-transform:uppercase;color:{MUTED}}} .top b{{color:{INK};font-weight:500}} .top i{{font-style:normal;color:{MOSS}}}
.sub{{position:absolute;left:0;right:0;bottom:30px;display:flex;flex-direction:column;align-items:center}}
.sub .who{{font:500 16px 'IBM Plex Mono';letter-spacing:2.5px;text-transform:uppercase;margin-bottom:6px}}
.sub .tx{{font:400 33px/1.25 Geist;color:{INK};max-width:1500px;text-align:center}}
.pill .tx{{background:rgba(244,241,234,.94);padding:10px 22px;border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,.18)}}
.pill .who{{background:rgba(244,241,234,.94);padding:3px 10px;border-radius:4px}}
.face{{position:absolute;left:1010px;right:100px;top:60px;bottom:60px;display:flex;flex-direction:column;justify-content:center}}
.face .nm{{font:500 16px 'IBM Plex Mono';letter-spacing:3px;text-transform:uppercase;color:{MOSS}}}
.face .bio{{font:400 24px Geist;color:{MUTED};margin-top:10px}}
.face .big{{font:300 58px/1.2 Newsreader;color:{INK};margin-top:48px;min-height:300px}}
.face .big.q{{font-style:italic}}
"""
WHO_COLOR = {"mira": MOSS, "sabine": BRICK, "lena": "#3d5a80"}
WHO_LABEL = {"mira": "Mira · the apprentice", **SPEAKER}


def overlay_html(state: tuple) -> str:
    kind, act, cue, extra = state
    body = ""
    if kind == "screen":
        body += (f"<div class=top><span><b>Tacet</b> &nbsp;·&nbsp; {html.escape(ACT.get(act, ''))}</span>"
                 f"<span><i>●</i> recorded live · tacet.up.railway.app</span></div>")
    if kind == "face":
        big = html.escape(cue["text"]) if cue else ""
        body += (f"<div class=face><div class=nm>Shubham Joshi · builder of Tacet</div>"
                 f"<div class=bio>Johns Hopkins graduate · San Francisco</div><div class='big{' q' if extra else ''}'>{big}</div></div>")
    elif cue:
        who = cue["who"]
        lab = (f"<div class=who style='color:{WHO_COLOR.get(who, MUTED)}'>{html.escape(WHO_LABEL[who])}</div>"
               if who in WHO_LABEL else "")
        body += f"<div class='sub{' pill' if kind != 'screen' else ''}'>{lab}<div class=tx>{html.escape(cue['text'])}</div></div>"
    return page(body, CSS)


def build_overlay(starts: list[float], total: float) -> list[dict]:
    allc = []
    segs = []  # (t0, t1, kind, act, quote)
    for i, s in enumerate(SHOTS):
        t0 = starts[i]
        t1 = starts[i + 1] if i + 1 < len(SHOTS) else total
        segs.append((t0, t1, s["kind"], s.get("act"), s.get("quote", False)))
        allc += cues(words_for(i, s, t0))
    allc.sort(key=lambda c: c["t"])
    marks = sorted({0.0, total, *(x for s in segs for x in s[:2]), *(c["t"] for c in allc), *(c["e"] for c in allc)})
    marks = [m for m in marks if 0 <= m <= total]
    states = []
    for a, b in zip(marks, marks[1:]):
        if b - a < 1 / FPS:
            continue
        mid = (a + b) / 2
        seg = next(sg for sg in segs if sg[0] <= mid < sg[1] or sg is segs[-1])
        cue = next((c for c in allc if c["t"] <= mid < c["e"]), None)
        kind = seg[2] if seg[2] != "card" else "card"
        if kind == "card":
            cue = None
        st = (kind, seg[3], cue, seg[4])
        states.append((a, b, st))
    pngs, jobs = {}, []
    for a, b, st in states:
        h_ = overlay_html(st)
        k = hashlib.md5(h_.encode()).hexdigest()[:12]
        if k not in pngs:
            pngs[k] = str(OUT / "ovl" / f"{k}.png")
            if not pathlib.Path(pngs[k]).exists():
                jobs.append((pngs[k], h_))
    if jobs:
        render(jobs)
    lst = OUT / "ovl" / "list.txt"
    lines = []
    for a, b, st in states:
        k = hashlib.md5(overlay_html(st).encode()).hexdigest()[:12]
        lines += [f"file '{pngs[k]}'", f"duration {b - a:.4f}"]
    lines.append(f"file '{pngs[k]}'")
    lst.write_text("\n".join(lines) + "\n")
    ff("-f", "concat", "-safe", "0", "-i", str(lst), "-vf", f"fps={FPS}", "-c:v", "qtrle", "-pix_fmt", "argb",
       "-t", f"{total:.3f}", str(OUT / "overlay.mov"))
    (OUT / "captions.vtt").write_text(vtt(allc))
    return allc


def vtt(cs: list[dict]) -> str:
    def ts(t: float) -> str:
        return f"{int(t // 3600):02d}:{int(t % 3600 // 60):02d}:{t % 60:06.3f}"
    return "WEBVTT\n\n" + "\n".join(f"{ts(c['t'])} --> {ts(c['e'])}\n"
                                     f"{(WHO_LABEL[c['who']].split(' ·')[0] + ': ') if c['who'] in WHO_LABEL else ''}{c['text']}\n"
                                     for c in cs)


# ------------------------------------------------------------------ audio
def build_audio(starts: list[float], total: float) -> None:
    ins, parts, n = [], [], 0
    for i, s in enumerate(SHOTS):
        for vid, off in s.get("vo", []):
            ins += ["-i", str(OUT / "vo" / f"{vid}.mp3")]
            g = 1.0 if vid.startswith("N") else 1.05
            parts.append(f"[{n}:a]aresample=48000,volume={g},adelay={int((starts[i] + off) * 1000)}:all=1[a{n}]")
            n += 1
        if s.get("audio"):
            ranges = s["segs"] if s["audio"] is True else s["audio"]
            for a, b in ranges:
                at = src_to_shot(s, a)
                ins += ["-ss", f"{a:.3f}", "-to", f"{b:.3f}", "-i", s["src"]]
                gain = 1.45 if s["kind"] == "face" else 1.9
                parts.append(f"[{n}:a]aresample=48000,pan=mono|c0=c0,highpass=f=90,afade=t=in:d=0.04,"
                             f"afade=t=out:st={b - a - 0.06:.3f}:d=0.06,volume={gain},adelay={int((starts[i] + at) * 1000)}:all=1[a{n}]")
                n += 1
    voice = "".join(f"[a{k}]" for k in range(n))
    ins += ["-i", str(OUT / "music.mp3")]
    fc = ";".join(parts) + f";{voice}amix=inputs={n}:normalize=0:duration=longest,apad,atrim=0:{total:.3f},asplit=2[vo][sc];"
    stretch = min(1.0, dur_of(str(OUT / "music.mp3")) / total)  # the bed ends with the film, never before it
    fc += (f"[{n}:a]aresample=48000,atempo={stretch:.4f},atrim=0:{total:.3f},volume=0.30,afade=t=in:d=1.5,afade=t=out:st={total - 4:.3f}:d=4[mu];"
           f"[mu][sc]sidechaincompress=threshold=0.03:ratio=6:attack=30:release=600[duck];"
           f"[vo][duck]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[out]")
    ff(*ins, "-filter_complex", fc, "-map", "[out]", "-ar", "48000", "-ac", "2", str(OUT / "mix.wav"))


def main() -> None:
    for d in ("png", "shots", "ovl", "stt"):
        (OUT / d).mkdir(parents=True, exist_ok=True)
    only = {int(x) for x in sys.argv[sys.argv.index("--shots") + 1].split(",")} if "--shots" in sys.argv else None
    if not (OUT / "png" / "bg.png").exists() or "--pngs" in sys.argv:
        static_pngs()
    for i, s in enumerate(SHOTS):
        if only is None and (OUT / "shots" / f"{i:02d}.mp4").exists() and "--force" not in sys.argv:
            continue
        if only is not None and i not in only:
            continue
        print(f"shot {i:02d} {s['kind']} {shot_len(s):.2f}s", flush=True)
        render_shot(i, s)
    starts = timeline()
    total = join(starts)
    print(f"timeline {total:.2f}s", flush=True)
    build_overlay(starts, total)
    build_audio(starts, total)
    ff("-i", str(OUT / "base.mp4"), "-i", str(OUT / "overlay.mov"), "-i", str(OUT / "mix.wav"), "-filter_complex",
       "[0:v][1:v]overlay=0:0:format=auto,format=yuv420p[v]", "-map", "[v]", "-map", "2:a", "-c:v", "libx264", "-crf", "18",
       "-preset", "slow", "-profile:v", "high", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "192k", "-shortest",
       str(OUT / "tacet-demo.mp4"))
    print("wrote", OUT / "tacet-demo.mp4", f"{total:.1f}s")


if __name__ == "__main__":
    main()
