# Audiobook / RSVP Reader

Expo app with **RSVP speed reading** (ReadCoach-style) and **Audio** mode. Karaoke highlighting removed.

## Online demo (GitHub Pages)

After the first successful deploy: **https://formone98127.github.io/audiobook/**

Static demo books ship under `public/books/` (**Alice**, chapters I–VI) **with TTS audio + word timings**, so RSVP **Audio Sync** works on Pages. Rebuild text / audio with:

```bash
# requires Gutenberg 11-0.txt in %TEMP%\alice.txt
python scripts/build-alice-demo.py
python scripts/generate-demo-audio.py
```

Full catalog + pipeline audio still needs `EXPO_PUBLIC_SERVER` or the LAN host.

## Run locally

```bash
npm install
npx expo start
```

Web: `npx expo start --web`  
Native still uses LAN server `http://192.168.31.218:8080` unless you set:

```bash
EXPO_PUBLIC_SERVER=https://your-books-host
```

## Export web

```bash
npx expo export -p web
```

GitHub Pages build sets `GITHUB_PAGES=1` so `experiments.baseUrl` is `/audiobook`.

## Features

- RSVP: WPM, chunk size 1–3, Push Mode, progress/ETA, chapter auto-advance
- Audio: plain text + play/pause, ±15s, speed, sleep, dictionary long-press
- Settings: font size + RSVP defaults
