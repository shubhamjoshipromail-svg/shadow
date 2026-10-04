# Tacet product film (designed motion)

`film.html` is a 1920x1080 composition whose whole visual state is a pure function of time (`window.seek(t)`).
Preview: open `film.html?t=12.5` (a still) or `film.html?play` (live loop).

Render (Chrome headless over CDP on port 9341, ffmpeg from design/video/node_modules):

    node design/film/render.mjs                 # frames -> out/film.mp4 (+ out/film.vtt), mixes vo + music
    node design/film/render.mjs --no-video      # re-mix audio / regenerate vtt only (needs out/silent.mp4)
    node design/film/render.mjs --stills 3,28   # PNG stills to out/stills/
    node design/film/render.mjs --sheet         # out/contact.jpg (a frame every 3s)
    node design/film/music.mjs [--force]        # optional ElevenLabs Music bed -> out/music.mp3 (key read from backend/.env)

Narration: the existing clips in design/video/out/vo/NN.mp3 are placed at the times in `LINES` (render.mjs) which must
match `L` in film.html. Captions (out/film.vtt) are generated from voiceover.txt with those timings.
Note `--no-video` needs out/silent.mp4; run a full render first.
