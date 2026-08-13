"""Generate demo MP3 + timings for public/books (GitHub Pages)."""
from __future__ import annotations

import asyncio
import json
import re
import subprocess
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BOOKS = ROOT / "public" / "books"

CJK_RE = re.compile(r"[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]")


def sentences_of(chapter: dict) -> list[str]:
    out: list[str] = []
    for p in chapter["paragraphs"]:
        for s in p["sentences"]:
            t = s["text"].strip()
            if t:
                out.append(t)
    return out


def words_of(sentence: str, cjk: bool) -> list[str]:
    if cjk:
        return [ch for ch in sentence if not ch.isspace() and not re.match(r"^[.,!?;:'\"“”‘’\-—–()[\]{}]+$", ch)]
    return sentence.split()


def plain_text(chapter: dict) -> str:
    return " ".join(sentences_of(chapter))


def duration_sec(path: Path) -> float:
    # Prefer ffprobe
    try:
        out = subprocess.check_output(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            text=True,
        ).strip()
        return float(out)
    except Exception:
        pass
    # WAV fallback
    with wave.open(str(path), "rb") as w:
        return w.getnframes() / float(w.getframerate())


def build_timings(chapter: dict, duration: float, cjk: bool) -> dict:
    sents = sentences_of(chapter)
    # weight by char length
    weights = [max(1, len(s)) for s in sents]
    total_w = sum(weights)
    sentences_json: list[list[float | int]] = []
    words_json: list[list[float | int]] = []
    t = 0.0
    for si, (sent, w) in enumerate(zip(sents, weights)):
        sent_dur = duration * (w / total_w)
        start = t
        end = t + sent_dur
        sentences_json.append([si, round(start, 3), round(end, 3)])
        toks = words_of(sent, cjk)
        if not toks:
            t = end
            continue
        tw = sum(max(1, len(x)) for x in toks)
        wt = start
        for wi, tok in enumerate(toks):
            wd = sent_dur * (max(1, len(tok)) / tw)
            words_json.append([si, wi, round(wt, 3), round(wt + wd, 3)])
            wt += wd
        t = end
    return {"chapter": chapter["index"], "sentences": sentences_json, "words": words_json}


async def synth(text: str, out_mp3: Path, voice: str) -> None:
    import edge_tts

    out_mp3.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_mp3.with_suffix(".raw.mp3")
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(str(tmp))
    # Compress for GitHub Pages
    subprocess.check_call(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(tmp),
            "-ac",
            "1",
            "-ar",
            "22050",
            "-b:a",
            "48k",
            str(out_mp3),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    tmp.unlink(missing_ok=True)


async def process_book(book_id: str, voice: str, cjk: bool) -> None:
    book_dir = BOOKS / book_id
    text = json.loads((book_dir / "text.json").read_text(encoding="utf-8"))
    manifest = json.loads((book_dir / "manifest.json").read_text(encoding="utf-8"))

    for ch in text["chapters"]:
        idx = ch["index"]
        audio_rel = f"audio/ch{idx:03d}.mp3"
        timing_rel = f"timings/ch{idx:03d}.json"
        audio_path = book_dir / audio_rel
        timing_path = book_dir / timing_rel
        body = plain_text(ch)
        print(f"[{book_id}] ch{idx} TTS ({len(body)} chars)…")
        await synth(body, audio_path, voice)
        dur = duration_sec(audio_path)
        timings = build_timings(ch, dur, cjk)
        timing_path.parent.mkdir(parents=True, exist_ok=True)
        timing_path.write_text(json.dumps(timings, ensure_ascii=False), encoding="utf-8")
        bytes_audio = audio_path.stat().st_size
        bytes_timing = timing_path.stat().st_size
        for mch in manifest["chapters"]:
            if mch["index"] == idx:
                mch["duration"] = round(dur, 2)
                mch["audio"] = {"url": audio_rel.replace("\\", "/"), "bytes": bytes_audio}
                mch["timings"] = {"url": timing_rel.replace("\\", "/"), "bytes": bytes_timing}
        print(f"[{book_id}] ch{idx} -> {dur:.1f}s, {bytes_audio} bytes")

    (book_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


async def main() -> None:
    await process_book("alice", "en-US-JennyNeural", cjk=False)
    await process_book("tang300", "zh-CN-XiaoxiaoNeural", cjk=True)
    print("done")


if __name__ == "__main__":
    asyncio.run(main())
