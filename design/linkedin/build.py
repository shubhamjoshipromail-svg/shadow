"""Tacet LinkedIn cut: 4:5 (1080x1350), ~40 s, built around one moment: the AI asks the expert.

    python3 design/linkedin/build.py            # full cut  -> out/tacet-linkedin.mp4
    python3 design/linkedin/build.py --short    # 26 s cut that ends on the rule -> out_short/tacet-linkedin-short.mp4
    --no-me                                     # skip Shubham's cloned-voice narration

Footage: the real screen recordings on ~/Desktop (same sources as design/demo/build.py), cropped tight so the UI reads
on a phone. Voices: Mira's lines (re-voiced from her on-screen text, design/demo/out/vo) and the expert's own recorded
answer. SFX from design/film/out/tech_sfx, music bed from design/demo/out/music.mp3 (enters only after the question).
"""
from __future__ import annotations

import base64, hashlib, html, json, os, pathlib, subprocess, sys

D = pathlib.Path(__file__).resolve().parent
ROOT = D.parents[1]
DEMO = ROOT / "design/demo"
SHORT = "--short" in sys.argv
OUT = D / ("out_short" if SHORT else "out")
FF = str(ROOT / "design/video/node_modules/ffmpeg-static/ffmpeg")
DESK = pathlib.Path.home() / "Desktop"
SFX = ROOT / "design/film/out/tech_sfx"
PAPER, SHEET, INK, MUTED, FAINT, MOSS, BRICK = "#f4f1ea", "#fbf9f4", "#1d1b16", "#6f6a5e", "#a39d90", "#4f6b3a", "#9b3b2b"
W, H, FPS = 1080, 1350, 30
PANEL = (36, 352, 1008, 780)           # x, y, w, h of the screen panel
FONTS = ("<link href='https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500"
         "&family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;1,6..72,300;1,6..72,400&display=block' rel='stylesheet'>")


def rec(name: str) -> str:
    return str(DESK / f"Screen Recording 2026-10-04 at {name}.mov")


# crops are (x, y, w, h) in the 2940x1626 source, all at the panel's aspect (1008/780)
def crop(x: int, y: int, w: int) -> tuple[int, int, int, int]:
    return (x, y, w, round(w * PANEL[3] / PANEL[2]))


BOOK = crop(1100, 400, 1100)     # cost-center dropdown: hovers 4711, picks 0400
ERP_WIDE = crop(1250, 318, 1690) # booking form + context column + where Mira's bubble lands
BUBBLE = crop(2150, 1000, 760)   # Mira's question bubble and avatar (stops short of the pink tab-sharing border)
MAP = crop(380, 560, 1340)       # Work Map: the rule, her quote, then its receipt
PROOF = crop(340, 450, 1480)     # sealed test: posterior, sha-256 commitment, sealed rows
LENA_WIDE = crop(1260, 340, 1660)
PLATE = crop(2180, 182, 760)     # "Mira stepped in" (below the browser chrome)

# src, segs (source seconds), speed, crop, badge
SHOTS = [
    dict(src=rec("2.26.29"), segs=[(52.9, 56.2)], box=BOOK),
    dict(src=rec("2.26.29"), segs=[(59.6, 61.4)], box=ERP_WIDE),
    dict(src=rec("2.26.29"), segs=[(61.4, 68.7), (70.25, 74.15), (75.2, 76.15)], box=BUBBLE, audio=[(70.25, 74.15), (75.2, 76.15)]),
    dict(src=rec("2.36.50"), segs=[(13.6, 19.0)], speed=1.2, box=MAP),
    dict(src=rec("2.39.22"), segs=[(10.0, 19.0)], speed=2.0, box=PROOF),
    dict(src=rec("2.29.16"), segs=[(145.3, 146.6)], box=LENA_WIDE),
    dict(src=rec("2.29.16"), segs=[(147.5, 155.8)], box=PLATE),
]
if SHORT:
    SHOTS = SHOTS[:4]
END_DUR = 6.0


def shot_len(s: dict) -> float:
    return sum(b - a for a, b in s["segs"]) / s.get("speed", 1)


STARTS = [sum(shot_len(s) for s in SHOTS[:i]) for i in range(len(SHOTS))]
MAIN = sum(shot_len(s) for s in SHOTS)
TOTAL = MAIN + END_DUR


def at(i: int, src_t: float) -> float:
    """Source second inside shot i -> timeline second."""
    s, acc = SHOTS[i], 0.0
    for a, b in s["segs"]:
        if a <= src_t <= b:
            return STARTS[i] + (acc + src_t - a) / s.get("speed", 1)
        acc += b - a
    raise ValueError(src_t)


BUBBLE_T = at(1, 61.0)          # Mira's question appears
ANSWER_T = at(2, 70.25)         # the expert starts answering
RULE_T = STARTS[3]
PROOF_T = STARTS[4] if not SHORT else None
PLATE_T = at(6, 147.55) if not SHORT else None
M01_TEMPO = 1.1

# ------------------------------------------------------------------ script: headline, captions, badges
KICK = "Tacet &nbsp;·&nbsp; an AI apprentice"
HEAD = [  # (from, html)
    (0.0, "<p class=a>Every AI demo: a person prompts the machine.</p>"),
    (BUBBLE_T, "<p class=dim>Every AI demo: a person prompts the machine.</p><p class=a>This one asks <em>the expert.</em></p>"),
    (ANSWER_T, "<p class=a>It saw her break the written process. So it asked <em>why.</em></p>"),
    (RULE_T, "<p class=a>Her answer is now a rule it can run, with <em>her own words</em> attached.</p>"),
]
if not SHORT:
    HEAD += [
        (PROOF_T, "<p class=a>Then a test it can't fake: answers <em>sealed</em> before anyone grades them.</p>"),
        (STARTS[5], "<p class=a>Monday. The new hire hits Post. It stops her <em>in the expert's words.</em></p>"),
    ]
HEAD.append((MAIN, ""))

WHO = {"mira": ("Mira · the apprentice", MOSS), "sabine": ("Sabine · the expert · played by Shubham", BRICK), "note": ("", MUTED)}


def m01(t: float) -> float:
    return BUBBLE_T + 0.1 + t / M01_TEMPO


CUES = [  # (t, e, who, text)
    (0.25, 3.25, "note", "The written process says 4711 Opex. The expert picks 0400 Capex."),
    (m01(0.15), m01(6.4), "mira", "You coded invoice 4471 to 0400 instead of 4711."),
    (m01(6.9), ANSWER_T - 0.15, "mira", "What made you do that?"),
    (ANSWER_T, at(2, 73.6), "sabine", "“Equipment over five thousand euros are always capex,”"),
    (at(2, 73.6), at(2, 76.15) + 0.3, "sabine", "“so it goes to zero four hundred.”"),
    (RULE_T + 0.3, RULE_T + shot_len(SHOTS[3]) - 0.1, "note", "Click the rule: the moment on screen, the field she changed, her exact words."),
]
if not SHORT:
    CUES += [
        (PROOF_T + 0.3, STARTS[5] - 0.1, "note", "Live run: 9 of 11. It learned from the two misses. Next round: 11 of 11."),
        (STARTS[5] + 0.1, PLATE_T, "note", "Capex booking. No asset number yet."),
        (PLATE_T + 0.15, PLATE_T + 2.75, "mira", "Sabine would stop here. Why do you think?"),
        (PLATE_T + 2.95, PLATE_T + 8.1, "mira", "Her rule: hold a capex booking until asset accounting provides an asset number."),
    ]


# Shubham's narration in his own cloned ElevenLabs voice ("me", eleven_v4). The expert's answer stays his real recording.
ME_VOICE = os.environ.get("TACET_ME_VOICE", "")
ME = [  # (id, start, text): each line says what the headline above it says
    ("V1", 0.15, "Every AI demo is a person prompting a machine."),
    ("V2", RULE_T + 0.2, "Her answer is now a rule it can run, with her own words attached."),
    ("V4", MAIN + 0.2, "Most AI records what experts do. Tacet learns why."),
]
if not SHORT:
    ME.insert(2, ("V3", PROOF_T + 0.1, "Then a test it can't fake. Answers sealed before anyone grades them."))


def me_tts() -> list[tuple[str, float]]:
    """Render missing narration lines with the 'me' voice (on the gen account: ELEVENLABS_GEN_API_KEY); returns
    (mp3, start) pairs. --no-me builds without narration."""
    if "--no-me" in sys.argv:
        return []
    import urllib.request
    key = next(l.split("=", 1)[1].strip().strip('"\'') for l in (ROOT / "backend/.env").read_text().splitlines()
               if l.startswith("ELEVENLABS_GEN_API_KEY="))
    voice = ME_VOICE or next(v["voice_id"] for v in json.load(urllib.request.urlopen(urllib.request.Request(
        "https://api.elevenlabs.io/v1/voices", headers={"xi-api-key": key})))["voices"] if v["name"].strip().lower() == "me")
    vo = D / "vo"
    vo.mkdir(exist_ok=True)
    out = []
    for vid, t, text in ME:
        f = vo / f"{vid}-{hashlib.md5((voice + text).encode()).hexdigest()[:8]}.mp3"
        if not f.exists():
            body = json.dumps({"text": text, "model_id": "eleven_v4",
                               "voice_settings": {"stability": 0.55, "similarity_boost": 0.9, "style": 0.1}}).encode()
            req = urllib.request.Request(f"https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_192", body,
                                         {"xi-api-key": key, "content-type": "application/json", "accept": "audio/mpeg"})
            with urllib.request.urlopen(req, timeout=120) as r:
                f.write_bytes(r.read())
            print("tts", vid, text, flush=True)
        out.append((str(f), t))
    return out


def badge(t: float) -> str:
    i = max(k for k, st in enumerate(STARTS) if st <= t)
    sp = SHOTS[i].get("speed", 1)
    return "real screen recording" + (f" &nbsp;·&nbsp; {sp:g}× speed" if sp != 1 else "")


# ------------------------------------------------------------------ helpers
def run(args: list[str]) -> None:
    subprocess.run(args, check=True)


def ff(*args: str) -> None:
    run([FF, "-y", "-loglevel", "error", *args])


def page(body: str, css: str = "") -> str:
    return (f"<!doctype html><html><head><meta charset=utf-8>{FONTS}<style>html,body{{margin:0;width:{W}px;height:{H}px;"
            f"background:transparent;overflow:hidden;-webkit-font-smoothing:antialiased}}*{{box-sizing:border-box}}{css}</style>"
            f"</head><body>{body}</body></html>")


def render(jobs: list[tuple[str, str]]) -> None:
    if not jobs:
        return
    p = OUT / "png" / "jobs.json"
    p.write_text(json.dumps([{"out": o, "html": h_} for o, h_ in jobs]))
    subprocess.run(["node", str(DEMO / "render_png.mjs"), str(p)], check=True, env={**os.environ, "PNG_W": str(W), "PNG_H": str(H)})


def sprite(px: int) -> str:
    uri = "data:image/png;base64," + base64.b64encode((ROOT / "design/film/mira-sprite.png").read_bytes()).decode()
    return f"<div style=\"width:{px}px;height:{px}px;background:url('{uri}') 0 0/200% 200% no-repeat\"></div>"


def static_pngs() -> None:
    x, y, w, h = PANEL
    bg = page(f"<div style='position:absolute;inset:0;background:{PAPER}'></div><div style='position:absolute;left:{x}px;top:{y}px;"
              f"width:{w}px;height:{h}px;border-radius:14px;background:#fff;box-shadow:0 18px 50px rgba(60,45,20,.16),0 2px 8px "
              f"rgba(60,45,20,.10)'></div>")
    mask = page(f"<div style='position:absolute;left:{x}px;top:{y}px;width:{w}px;height:{h}px;border-radius:14px;"
                f"box-shadow:0 0 0 1px rgba(40,30,15,.14),0 0 0 2600px {PAPER}'></div>")
    end = page(f"""<div class=c>{sprite(190)}
      <div class=l1>Most AI records what experts do.</div>
      <div class=l2>Tacet learns <em>why.</em></div>
      <div class=u>tacet.up.railway.app</div>
      <div class=m>Built solo for HackNation × ElevenLabs</div>
      <div class=e>Real recordings · Mira's lines re-voiced from her on-screen words</div></div>""",
               f"body{{background:{PAPER}}}.c{{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;"
               f"justify-content:center;text-align:center;padding:0 70px}}.l1{{font:300 58px/1.15 Newsreader;color:{MUTED};margin-top:40px}}"
               f".l2{{font:400 96px/1.1 Newsreader;color:{INK};margin-top:14px;letter-spacing:-1.5px}}em{{color:{MOSS}}}"
               f".u{{font:500 34px 'IBM Plex Mono';color:{MOSS};margin-top:70px}}.m{{font:400 26px Geist;color:{MUTED};margin-top:40px}}"
               f".e{{font:400 18px 'IBM Plex Mono';color:{FAINT};margin-top:14px;letter-spacing:.3px}}")
    render([(str(OUT / "png" / f"{n}.png"), h_) for n, h_ in (("bg", bg), ("mask", mask), ("end", end))])


CSS = f"""
.k{{position:absolute;left:60px;top:58px;font:500 19px 'IBM Plex Mono';letter-spacing:3.5px;text-transform:uppercase;color:{MOSS}}}
.h{{position:absolute;left:60px;right:60px;top:104px;height:230px;display:flex;flex-direction:column;justify-content:center}}
.h p{{margin:0;font:400 62px/1.1 Newsreader;color:{INK};letter-spacing:-.6px}}
.h p.dim{{font-size:40px;color:{FAINT};margin-bottom:14px}}
.h em{{font-style:italic;color:{MOSS}}}
.b{{position:absolute;left:{PANEL[0] + 4}px;top:{PANEL[1] + PANEL[3] + 16}px;font:500 16px 'IBM Plex Mono';letter-spacing:2.5px;
   text-transform:uppercase;color:{FAINT}}} .b i{{font-style:normal;color:{BRICK}}}
.s{{position:absolute;left:60px;right:60px;top:1190px;height:140px;display:flex;flex-direction:column;align-items:center;
   justify-content:flex-start;text-align:center}}
.s .w{{font:500 17px 'IBM Plex Mono';letter-spacing:2.5px;text-transform:uppercase;margin-bottom:10px}}
.s .t{{font:400 37px/1.22 Geist;color:{INK}}} .s.note .t{{color:{MUTED};font-size:33px}}
"""


def overlay_html(head: str, cue: tuple | None, bdg: str) -> str:
    if not head and not cue:
        return page("", CSS)
    body = f"<div class=k>{KICK}</div><div class=h>{head}</div><div class=b><i>●</i> {bdg}</div>"
    if cue:
        lab, col = WHO[cue[2]]
        body += (f"<div class='s {cue[2]}'>" + (f"<div class=w style='color:{col}'>{html.escape(lab)}</div>" if lab else "")
                 + f"<div class=t>{html.escape(cue[3])}</div></div>")
    return page(body, CSS)


# ------------------------------------------------------------------ video
def render_shot(i: int, s: dict) -> str:
    out = str(OUT / "shots" / f"{i:02d}.mp4")
    a0, b1 = max(0.0, s["segs"][0][0] - 1), s["segs"][-1][1] + 1
    trims = "".join(f"[0:v]trim=start={a - a0:.3f}:end={b - a0:.3f},setpts=PTS-STARTPTS[s{k}];" for k, (a, b) in enumerate(s["segs"]))
    x, y, w, h = s["box"]
    fc = (trims + "".join(f"[s{k}]" for k in range(len(s["segs"]))) + f"concat=n={len(s['segs'])}:v=1:a=0,"
          f"setpts=PTS/{s.get('speed', 1)},fps={FPS},crop={w}:{h}:{x}:{y},scale={PANEL[2]}:{PANEL[3]}:flags=lanczos,setsar=1[v]")
    ff("-ss", f"{a0:.3f}", "-to", f"{b1:.3f}", "-i", s["src"], "-filter_complex", fc, "-map", "[v]", "-t", f"{shot_len(s):.3f}",
       "-c:v", "libx264", "-crf", "14", "-preset", "medium", "-pix_fmt", "yuv420p", "-r", str(FPS), "-an", out)
    return out


def build_base() -> None:
    lst = OUT / "shots" / "list.txt"
    lst.write_text("".join(f"file '{OUT / 'shots' / f'{i:02d}.mp4'}'\n" for i in range(len(SHOTS))))
    ff("-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(OUT / "panel.mp4"))
    png = OUT / "png"
    px, py = PANEL[:2]
    fade = 0.45
    fc = (f"[1:v][0:v]overlay={px}:{py}[o];[o][2:v]overlay=0:0,trim=0:{MAIN:.3f},setpts=PTS-STARTPTS,format=yuv420p[m];"
          f"[3:v]fps={FPS},format=yuv420p,trim=0:{END_DUR + fade:.3f},setpts=PTS-STARTPTS[e];"
          f"[m][e]xfade=transition=fade:duration={fade}:offset={MAIN - fade:.3f},format=yuv420p[v]")
    ff("-i", str(OUT / "panel.mp4"), "-loop", "1", "-framerate", str(FPS), "-i", str(png / "bg.png"), "-loop", "1", "-framerate",
       str(FPS), "-i", str(png / "mask.png"), "-loop", "1", "-framerate", str(FPS), "-i", str(png / "end.png"),
       "-filter_complex", fc, "-map", "[v]", "-t", f"{TOTAL - fade:.3f}", "-c:v", "libx264", "-crf", "14", "-preset", "medium",
       "-r", str(FPS), str(OUT / "base.mp4"))


def build_overlay() -> None:
    total = TOTAL - 0.45
    marks = sorted({0.0, total, *(t for t, _ in HEAD), *(c[0] for c in CUES), *(c[1] for c in CUES), *STARTS})
    marks = [m for m in marks if 0 <= m <= total]
    states = []
    for a, b in zip(marks, marks[1:]):
        if b - a < 1 / FPS:
            continue
        mid = (a + b) / 2
        head = [hh for t, hh in HEAD if t <= mid][-1]
        cue = next((c for c in CUES if c[0] <= mid < c[1]), None)
        states.append((a, b, overlay_html(head, cue if head else None, badge(mid))))
    files, jobs = [], []
    for a, b, h_ in states:
        f = str(OUT / "ovl" / (hashlib.md5(h_.encode()).hexdigest()[:12] + ".png"))
        if not pathlib.Path(f).exists() and all(f != j[0] for j in jobs):
            jobs.append((f, h_))
        files.append((f, b - a))
    render(jobs)
    lst = OUT / "ovl" / "list.txt"
    lst.write_text("".join(f"file '{f}'\nduration {d:.4f}\n" for f, d in files) + f"file '{files[-1][0]}'\n")
    ff("-f", "concat", "-safe", "0", "-i", str(lst), "-vf", f"fps={FPS}", "-c:v", "qtrle", "-pix_fmt", "argb", "-t", f"{total:.3f}",
       str(OUT / "overlay.mov"))
    def ts(t: float) -> str:
        return f"{int(t // 3600):02d}:{int(t % 3600 // 60):02d}:{t % 60:06.3f}"
    (OUT / "captions.vtt").write_text("WEBVTT\n\n" + "\n".join(
        f"{ts(t)} --> {ts(e)}\n{(WHO[w][0].split(' ·')[0] + ': ') if WHO[w][0] else ''}{tx}\n" for t, e, w, tx in CUES))


# ------------------------------------------------------------------ audio
def build_audio() -> None:
    total = TOTAL - 0.45
    ins, parts = [], []

    def add(path: str, t: float, gain: float, pre: list[str] = (), filt: str = "") -> None:
        n = len(parts)
        ins.extend([*pre, "-i", path])
        parts.append(f"[{n}:a]aresample=48000,{filt}volume={gain},adelay={int(t * 1000)}:all=1[a{n}]")

    for path, t in me_tts():
        add(path, t, 1.0)
    vo = DEMO / "out/vo"
    add(str(vo / "M01.mp3"), BUBBLE_T + 0.1, 1.05, filt=f"atempo={M01_TEMPO},")
    s = SHOTS[2]
    for a, b in s["audio"]:
        add(s["src"], at(2, a), 1.9, pre=["-ss", f"{a:.3f}", "-to", f"{b:.3f}"],
            filt=f"pan=mono|c0=c0,highpass=f=90,afade=t=in:d=0.04,afade=t=out:st={b - a - 0.06:.3f}:d=0.06,")
    sfx = [("click", at(0, 55.55), 0.55), ("chime", BUBBLE_T, 0.45), ("stamp", RULE_T + 0.25, 0.6)]
    if not SHORT:
        add(str(vo / "M03.mp3"), PLATE_T + 0.1, 1.05)
        sfx += [("tick", PROOF_T + 0.3, 0.5), ("click", at(5, 146.3), 0.55), ("chime", PLATE_T, 0.45)]
    nvo = len(parts)
    for name, t, g in sfx:
        add(str(SFX / f"{name}.mp3"), t, g)
    nall = len(parts)
    ins += ["-ss", "20", "-i", str(DEMO / "out/music.mp3")]
    mus_t = ANSWER_T + 4.5          # silence until the reversal has landed
    fc = ";".join(parts)
    fc += ";" + "".join(f"[a{k}]" for k in range(nvo)) + f"amix=inputs={nvo}:normalize=0,apad,atrim=0:{total:.3f},asplit=2[vo][sc]"
    fc += ";" + "".join(f"[a{k}]" for k in range(nvo, nall)) + f"amix=inputs={nall - nvo}:normalize=0,apad,atrim=0:{total:.3f}[fx]"
    fc += (f";[{nall}:a]aresample=48000,atrim=0:{total - mus_t:.3f},volume=0.34,afade=t=in:d=1.2,"
           f"afade=t=out:st={total - mus_t - 2.5:.3f}:d=2.5,adelay={int(mus_t * 1000)}:all=1,apad,atrim=0:{total:.3f}[mu]"
           f";[mu][sc]sidechaincompress=threshold=0.03:ratio=6:attack=30:release=600[duck]"
           f";[vo][fx][duck]amix=inputs=3:normalize=0,loudnorm=I=-15:TP=-1.5:LRA=11[out]")
    ff(*ins, "-filter_complex", fc, "-map", "[out]", "-ar", "48000", "-ac", "2", str(OUT / "mix.wav"))


def main() -> None:
    for d in ("png", "shots", "ovl"):
        (OUT / d).mkdir(parents=True, exist_ok=True)
    static_pngs()
    for i, s in enumerate(SHOTS):
        if not (OUT / "shots" / f"{i:02d}.mp4").exists() or "--force" in sys.argv:
            print(f"shot {i} {shot_len(s):.2f}s", flush=True)
            render_shot(i, s)
    build_base()
    build_overlay()
    build_audio()
    name = "tacet-linkedin-short.mp4" if SHORT else "tacet-linkedin.mp4"
    ff("-i", str(OUT / "base.mp4"), "-i", str(OUT / "overlay.mov"), "-i", str(OUT / "mix.wav"), "-filter_complex",
       "[0:v][1:v]overlay=0:0:format=auto,format=yuv420p[v]", "-map", "[v]", "-map", "2:a", "-c:v", "libx264", "-crf", "17",
       "-preset", "slow", "-profile:v", "high", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "192k", "-shortest", str(OUT / name))
    ff("-ss", f"{BUBBLE_T + 1.2:.2f}", "-i", str(OUT / name), "-frames:v", "1", "-q:v", "2", str(OUT / "cover.jpg"))
    print("wrote", OUT / name, f"{TOTAL - 0.45:.1f}s", f"bubble@{BUBBLE_T:.2f} answer@{ANSWER_T:.2f} rule@{RULE_T:.2f}")


if __name__ == "__main__":
    main()
