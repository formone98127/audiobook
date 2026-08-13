"""Generate demo MP3 + word-boundary timings for public/books (GitHub Pages)."""
from __future__ import annotations

import asyncio
import json
import re
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BOOKS = ROOT / "public" / "books"

PUNCT_ONLY = re.compile(r"^[.,!?;:'\"“”‘’\-—–()[\]{}<>/\\@#$%^&*_+=|~`]+$")


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
        return [ch for ch in sentence if not ch.isspace() and not PUNCT_ONLY.match(ch)]
    return [w for w in sentence.split() if w and not PUNCT_ONLY.match(w)]


def plain_text(chapter: dict) -> str:
    return " ".join(sentences_of(chapter))


def duration_sec(path: Path) -> float:
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


def compress_mp3(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.check_call(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(src),
            "-ac",
            "1",
            "-ar",
            "22050",
            "-b:a",
            "48k",
            str(dst),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


async def synth_with_boundaries(
    text: str, voice: str
) -> tuple[bytes, list[dict[str, float | str]]]:
    import edge_tts

    audio = bytearray()
    bounds: list[dict[str, float | str]] = []
    communicate = edge_tts.Communicate(text, voice, boundary="WordBoundary")
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio.extend(chunk["data"])
        elif chunk["type"] == "WordBoundary":
            start = chunk["offset"] / 1e7
            end = start + chunk["duration"] / 1e7
            bounds.append({"text": chunk["text"], "start": start, "end": end})
    return bytes(audio), bounds


def build_timings_from_bounds(
    chapter: dict,
    bounds: list[dict[str, float | str]],
    cjk: bool,
    time_scale: float = 1.0,
) -> dict:
    sents = sentences_of(chapter)
    expected: list[tuple[int, int, str]] = []
    for si, sent in enumerate(sents):
        for wi, tok in enumerate(words_of(sent, cjk)):
            expected.append((si, wi, tok))

    # Keep boundary times faithful; client TimingIndex applies display lead.
    LEAD = 0.0
    scaled = [
        {
            "start": max(0.0, float(b["start"]) * time_scale - LEAD),
            "end": max(0.0, float(b["end"]) * time_scale - LEAD),
        }
        for b in bounds
    ]

    words_json: list[list[float | int]] = []
    n = len(expected)
    m = len(scaled)

    if m == 0 and n > 0:
        # Shouldn't happen; keep empty and let caller fall back.
        return {"chapter": chapter["index"], "sentences": [], "words": []}

    for i, (si, wi, _tok) in enumerate(expected):
        if m == n:
            b = scaled[i]
        elif m > 0:
            # Resample boundary timeline onto expected word count.
            pos = i * (m - 1) / max(1, n - 1) if n > 1 else 0
            lo = int(pos)
            hi = min(lo + 1, m - 1)
            frac = pos - lo
            start = scaled[lo]["start"] * (1 - frac) + scaled[hi]["start"] * frac
            end = scaled[lo]["end"] * (1 - frac) + scaled[hi]["end"] * frac
            b = {"start": start, "end": end}
        else:
            b = {"start": 0.0, "end": 0.0}
        # Ensure monotonic non-zero span
        start = float(b["start"])
        end = max(float(b["end"]), start + 0.04)
        words_json.append([si, wi, round(start, 3), round(end, 3)])

    # Sentence spans from first/last word
    sentences_json: list[list[float | int]] = []
    by_sent: dict[int, list[list[float | int]]] = {}
    for row in words_json:
        by_sent.setdefault(int(row[0]), []).append(row)
    for si in range(len(sents)):
        rows = by_sent.get(si, [])
        if not rows:
            sentences_json.append([si, 0.0, 0.0])
        else:
            sentences_json.append([si, rows[0][2], rows[-1][3]])

    return {"chapter": chapter["index"], "sentences": sentences_json, "words": words_json}


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
        print(f"[{book_id}] ch{idx} TTS+boundaries ({len(body)} chars)…")

        raw_audio, bounds = await synth_with_boundaries(body, voice)
        with tempfile.TemporaryDirectory() as td:
            raw_path = Path(td) / "raw.mp3"
            raw_path.write_bytes(raw_audio)
            raw_dur = duration_sec(raw_path)
            compress_mp3(raw_path, audio_path)
        final_dur = duration_sec(audio_path)
        scale = final_dur / raw_dur if raw_dur > 0 else 1.0

        timings = build_timings_from_bounds(ch, bounds, cjk, time_scale=scale)
        timing_path.parent.mkdir(parents=True, exist_ok=True)
        timing_path.write_text(json.dumps(timings, ensure_ascii=False), encoding="utf-8")

        bytes_audio = audio_path.stat().st_size
        bytes_timing = timing_path.stat().st_size
        for mch in manifest["chapters"]:
            if mch["index"] == idx:
                mch["duration"] = round(final_dur, 2)
                mch["audio"] = {"url": audio_rel.replace("\\", "/"), "bytes": bytes_audio}
                mch["timings"] = {"url": timing_rel.replace("\\", "/"), "bytes": bytes_timing}

        exp = sum(len(words_of(s, cjk)) for s in sentences_of(ch))
        print(
            f"[{book_id}] ch{idx} -> {final_dur:.1f}s, "
            f"bounds={len(bounds)} expected={exp} scale={scale:.4f}"
        )

    (book_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


async def main() -> None:
    await process_book("alice", "en-US-JennyNeural", cjk=False)
    print("done")


if __name__ == "__main__":
    asyncio.run(main())
