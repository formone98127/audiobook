# Lumina RSVP — YouTube video generator

Standalone. Does not touch the Expo app.

Needs **Python 3.10+**, **ffmpeg** on PATH, and Pillow.

```text
cd tools/rsvp-video
pip install -r requirements.txt
python gui.py
```

Run from this folder (or `python tools/rsvp-video/gui.py` from the repo root — `sys.path` is set in `gui.py`).

## GUI

- Book from `public/books/`
- One or more chapters (one MP4 each)
- **16:9 1080p** or **9:16 Shorts**
- Light / dark Lumina
- Text lead (default `+0.2s`, same idea as Later/Earlier in the reader)
- Output folder (default `out/rsvp-video/`)

Files look like `Alices_Adventures_in_Wonderland_ch00_I._Down_the_Rabbit-Hole_1080p.mp4`.

## Timeline

2s title card → RSVP + chapter MP3 (word timings) → 1s hold on the last word.

No motion on the flash. Words are still frames muxed with ffmpeg.
