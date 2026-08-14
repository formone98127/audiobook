"""Align Alice timings to the final MP3s via Whisper word clocks.

Do not greedy-match Whisper's text to the book. Token mismatches accumulate
and by mid-chapter the RSVP stream is minutes off. Stretch Whisper's word
start/end times onto the expected token count so first/last stay pinned
to the audio and nothing can walk away.
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

from faster_whisper import WhisperModel

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


def whisper_words(model: WhisperModel, audio_path: Path) -> list[dict[str, float]]:
    segments, _info = model.transcribe(
        str(audio_path),
        word_timestamps=True,
        language="en",
        beam_size=5,
        vad_filter=False,
        condition_on_previous_text=False,
    )
    heard: list[dict[str, float]] = []
    for seg in segments:
        for w in seg.words or []:
            start = float(w.start)
            end = max(float(w.end), start + 0.04)
            heard.append({"start": start, "end": end})
    return heard


def stretch(heard: list[dict[str, float]], n: int, dur: float) -> list[dict[str, float]]:
    """Map n book tokens onto the heard timeline. Monotone, pinned to [0, dur]."""
    if n <= 0:
        return []
    if not heard:
        step = dur / max(1, n)
        return [{"start": i * step, "end": (i + 1) * step} for i in range(n)]

    starts = [h["start"] for h in heard]
    ends = [h["end"] for h in heard]
    m = len(starts)
    out: list[dict[str, float]] = []
    for i in range(n):
        pos = 0.0 if n == 1 else i * (m - 1) / (n - 1)
        lo = int(pos)
        hi = min(lo + 1, m - 1)
        frac = pos - lo
        start = starts[lo] * (1 - frac) + starts[hi] * frac
        end = ends[lo] * (1 - frac) + ends[hi] * frac
        start = max(0.0, min(start, dur))
        end = max(start + 0.04, min(end, dur + 0.04))
        out.append({"start": start, "end": end})

    # Enforce monotone after rounding noise
    for i in range(1, len(out)):
        if out[i]["start"] < out[i - 1]["start"]:
            out[i]["start"] = out[i - 1]["start"]
        if out[i]["end"] < out[i]["start"] + 0.04:
            out[i]["end"] = out[i]["start"] + 0.04
    return out


def build_timings(
    chapter: dict, spans: list[dict[str, float]], cjk: bool
) -> dict:
    sents = sentences_of(chapter)
    expected: list[tuple[int, int, str]] = []
    for si, sent in enumerate(sents):
        for wi, tok in enumerate(words_of(sent, cjk)):
            expected.append((si, wi, tok))

    words_json: list[list[float | int]] = []
    for i, (si, wi, _tok) in enumerate(expected):
        b = spans[i] if i < len(spans) else {"start": 0.0, "end": 0.04}
        words_json.append(
            [si, wi, round(float(b["start"]), 3), round(float(b["end"]), 3)]
        )

    sentences_json: list[list[float | int]] = []
    by_sent: dict[int, list[list[float | int]]] = {}
    for row in words_json:
        by_sent.setdefault(int(row[0]), []).append(row)
    for si in range(len(sents)):
        rows = by_sent.get(si, [])
        if not rows:
            continue
        sentences_json.append([si, rows[0][2], rows[-1][3]])

    tokens = [tok for _si, _wi, tok in expected]
    return {
        "chapter": chapter["index"],
        "sentences": sentences_json,
        "words": words_json,
        "tokens": tokens,
    }


def main() -> None:
    book_dir = BOOKS / "alice"
    text = json.loads((book_dir / "text.json").read_text(encoding="utf-8"))
    model = WhisperModel("base.en", device="cpu", compute_type="int8")
    for ch in text["chapters"]:
        idx = ch["index"]
        audio_path = book_dir / "audio" / f"ch{idx:03d}.mp3"
        timing_path = book_dir / "timings" / f"ch{idx:03d}.json"
        expected: list[str] = []
        for sent in sentences_of(ch):
            expected.extend(words_of(sent, cjk=False))
        dur = duration_sec(audio_path)
        print(f"[alice] ch{idx} whisper {audio_path.name} ({len(expected)} words, {dur:.1f}s)…")
        heard = whisper_words(model, audio_path)
        spans = stretch(heard, len(expected), dur)
        timings = build_timings(ch, spans, cjk=False)
        timing_path.write_text(json.dumps(timings, ensure_ascii=False), encoding="utf-8")
        last = spans[-1]["start"] if spans else 0
        print(f"[alice] ch{idx} -> heard={len(heard)} tokens={len(expected)} last={last:.1f}s")


if __name__ == "__main__":
    main()
