import subprocess
F="/Users/shubhamjoshi/Hacknation 2/design/video/node_modules/ffmpeg-static/ffmpeg"
SEGS=[(2.55,3.25),(4.25,12.95),(14.0,37.3),(38.35,40.75),(42.4,46.95),(46.95,60.6)]
fc="";cat=""
for i,(a,b) in enumerate(SEGS):
    d=b-a
    fc+=f"[0:v]trim={a}:{b},setpts=PTS-STARTPTS[V{i}];[0:a]atrim={a}:{b},asetpts=PTS-STARTPTS,afade=t=in:d=0.03,afade=t=out:st={d-0.04:.3f}:d=0.04[A{i}];"
    cat+=f"[V{i}][A{i}]"
fc+=cat+f"concat=n={len(SEGS)}:v=1:a=1[v][a]"
subprocess.run([F,"-y","-loglevel","error","-i","full.mov","-filter_complex",fc,"-map","[v]","-map","[a]","-c:v","libx264","-crf","14","-preset","fast","-c:a","pcm_s16le","base.mov"],check=True)
t=0
for a,b in SEGS: print(f"src {a}-{b} -> out {t:.2f}-{t+b-a:.2f}"); t+=b-a
