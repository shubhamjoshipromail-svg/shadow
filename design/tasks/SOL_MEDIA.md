# Sol task: generated media for the submission videos (ElevenLabs Pro)

Repo: /Users/shubhamjoshi/Hacknation 2. Product Tacet, apprentice Mira (pixel-art intern). Read `design/DESIGN.md`,
`design/film/README.md`, and look at `design/film/out/contact.jpg` (the product film look) and
`design/film/assets/candidates/compare.jpg` (earlier attempts). The owner judged Google Flow / Veo clips generic.

Keys: `backend/.env` (gitignored) has `ELEVENLABS_GEN_API_KEY` (a Pro account dedicated to generation; prefer it for
image/video/lip-sync) and `ELEVENLABS_API_KEY` (Pro; voices/agents). Load at runtime; NEVER print, log or commit keys.
ElevenLabs API: `POST/GET /v1/flows/video`, `/v1/flows/image` (models incl. veo-3.1-generate-001, veo-3.1-fast-generate-001,
bytedance-seedance-v2/2.5 (may need approval), creatify-aurora (image+audio → talking video), gpt-image-2.5-*,
gemini-3-pro-image, seedream-5-pro …). Check https://elevenlabs.io/docs/llms.txt and the Image & Video docs for exact
request shapes. First GET to confirm access with the generation key. Show the credit cost before each generation in
your output; keep the total under ~15 video generations.

Deliver into `design/film/assets/gen/` (new folder):
1. **Cold open, Shot A "Friday 4:10 pm"**: image-to-video from the still
   `design/film/assets/candidates/gpt-image-2.5-flare-A-still.png` (start frame). Motion: dust drifting in the blind light,
   the light stripes creeping slowly, a curl of steam? no (coffee is cold); a very slow push-in. 6–8s, 16:9, 1080p.
   Try Veo 3.1 and Seedance (if allowed); pick the best; keep the still's look (no new objects, no text changes).
2. **Shot B "Monday"**: image-to-video from `gpt-image-2.5-flare-B-still.png`; the new hire's hands set down the badge and
   open the notebook; same grade. 6–8s.
3. **Mira talks (team video)**: a talking pixel-art Mira. Crop her portrait from `backend/shadow/static/intern.png` (top-left
   region; capture.js uses viewBox "145 96 426 520") and upscale with nearest-neighbour to keep pixels crisp. Voice: Jessica
   `cgSgspJ2msm6clMCkdW9`, model `eleven_v4`, line: "Hi, I'm Mira. I sit beside an expert, ask one question at the right
   pause, and teach the next person in her words." Try creatify-aurora (image + audio). If the result breaks the pixel-art
   look, ALSO make a local fallback: a mouth-flap animation (2–3 mouth frames drawn in her pixel style, driven by the audio
   amplitude with ffmpeg/Node) and compare. Deliver `mira-talks.mp4` (+ `mira-talks.wav`).
4. A comparison sheet `design/film/assets/gen/compare.jpg` and a short `design/film/assets/gen/REPORT.md`: models tried,
   credit costs, ranked picks, and the honest look of each (any AI tells).
Rules: no git commits; only write inside `design/film/assets/`; never use port 8000.
