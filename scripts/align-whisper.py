"""Re-align Alice timings with Whisper word timestamps on the final MP3s."""
from __future__ import annotations

import json
import re
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


def norm(tok: str) -> str:
    t = tok.strip().lower()
    t = re.sub(r"^[^a-z0-9]+|[^a-z0-9]+$", "", t)
    t = t.replace("’", "'")
    return t


def align_chapter(
    model: WhisperModel,
    audio_path: Path,
    expected: list[str],
) -> list[dict[str, float]]:
    """Whisper word stamps, mapped onto expected tokens (1:1 by order)."""
    segments, _info = model.transcribe(
        str(audio_path),
        word_timestamps=True,
        language="en",
        beam_size=5,
        vad_filter=False,
        condition_on_previous_text=False,
    )
    heard: list[dict[str, float | str]] = []
    for seg in segments:
        for w in seg.words or []:
            heard.append({"text": w.word, "start": float(w.start), "end": float(w.end)})

    # Greedy monotone match: walk heard words, assign to expected tokens.
    out: list[dict[str, float]] = []
    hi = 0
    for tok in expected:
        target = norm(tok)
        best = None
        # scan forward a small window for a matching heard word
        for j in range(hi, min(len(heard), hi + 12)):
            if norm(str(heard[j]["text"])) == target:
                best = j
                break
        if best is None:
            # no match — take next heard word in order
            best = min(hi, len(heard) - 1)
        hi = best + 1
        w = heard[best]
        out.append({"start": float(w["start"]), "end": float(w["end"])})
    return out


def build_timings(chapter: dict, spans: list[dict[str, float]], cjk: bool) -> dict:
    sents = sentences_of(chapter)
    expected: list[tuple[int, int, str]] = []
    for si, sent in enumerate(sents):
        for wi, tok in enumerate(words_of(sent, cjk)):
            expected.append((si, wi, tok))

    words_json: list[list[float | int]] = []
    for i, (si, wi, _tok) in enumerate(expected):
        b = spans[i] if i < len(spans) else {"start": 0.0, "end": 0.0}
        start = float(b["start"])
        end = max(float(b["end"]), start + 0.04)
        words_json.append([si, wi, round(start, 3), round(end, 3)])

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
        print(f"[alice] ch{idx} whisper-align {audio_path.name} ({len(expected)} words)…")
        spans = align_chapter(model, audio_path, expected)
        timings = build_timings(ch, spans, cjk=False)
        timing_path.write_text(json.dumps(timings, ensure_ascii=False), encoding="utf-8")
        print(f"[alice] ch{idx} -> {len(spans)} spans")


if __name__ == "__main__":
    main()
