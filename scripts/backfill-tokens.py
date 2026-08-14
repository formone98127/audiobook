"""Backfill canonical RSVP tokens into existing timing JSONs (no TTS re-run)."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BOOKS = ROOT / "public" / "books"

PUNCT_ONLY = re.compile(r"^[.,!?;:'\"“”‘’\-—–()[\]{}<>/\\@#$%^&*_+=|~`]+$")


def words_of(sentence: str, cjk: bool) -> list[str]:
    if cjk:
        return [ch for ch in sentence if not ch.isspace() and not PUNCT_ONLY.match(ch)]
    return [w for w in sentence.split() if w and not PUNCT_ONLY.match(w)]


def sentences_of(chapter: dict) -> list[str]:
    out: list[str] = []
    for p in chapter["paragraphs"]:
        for s in p["sentences"]:
            t = s["text"].strip()
            if t:
                out.append(t)
    return out


def process_book(book_id: str, cjk: bool) -> None:
    book_dir = BOOKS / book_id
    text = json.loads((book_dir / "text.json").read_text(encoding="utf-8"))
    for ch in text["chapters"]:
        idx = ch["index"]
        timing_path = book_dir / "timings" / f"ch{idx:03d}.json"
        timings = json.loads(timing_path.read_text(encoding="utf-8"))
        tokens: list[str] = []
        for sent in sentences_of(ch):
            tokens.extend(words_of(sent, cjk))
        n_words = len(timings.get("words", []))
        if len(tokens) != n_words:
            print(f"[{book_id}] ch{idx} MISMATCH tokens={len(tokens)} words={n_words}")
            continue
        timings["tokens"] = tokens
        timing_path.write_text(json.dumps(timings, ensure_ascii=False), encoding="utf-8")
        print(f"[{book_id}] ch{idx} tokens={len(tokens)} ok")


if __name__ == "__main__":
    process_book("alice", cjk=False)
    print("done")
