"""Build public/books/alice/text.json + manifest stubs from Gutenberg #11."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "books" / "alice"
SRC = Path(os.environ.get("TEMP", "/tmp")) / "alice.txt"

CHAPTER_TITLES = [
    "I. Down the Rabbit-Hole",
    "II. The Pool of Tears",
    "III. A Caucus-Race and a Long Tale",
    "IV. The Rabbit Sends in a Little Bill",
    "V. Advice from a Caterpillar",
    "VI. Pig and Pepper",
    "VII. A Mad Tea-Party",
    "VIII. The Queen's Croquet-Ground",
    "IX. The Mock Turtle's Story",
    "X. The Lobster Quadrille",
    "XI. Who Stole the Tarts?",
    "XII. Alice's Evidence",
]

# How many chapters to ship on Pages (full book is huge for TTS/repo).
NUM_CHAPTERS = 6


def clean_text(raw: str) -> str:
    repl = {
        "\ufeff": "",
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "—": "-",
        "–": "-",
        "_": "",
    }
    for a, b in repl.items():
        raw = raw.replace(a, b)
    return raw


def split_sentences(paragraph: str) -> list[str]:
    paragraph = re.sub(r"\s+", " ", paragraph).strip()
    if not paragraph:
        return []
    parts = re.split(r"(?<=[.!?])\s+(?=[\"A-Z])", paragraph)
    out = [p.strip() for p in parts if p.strip()]
    return out or [paragraph]


def parse_chapters(text: str) -> list[dict]:
    start = re.search(r"CHAPTER I\.\s*\nDown the Rabbit-Hole", text)
    if not start:
        start = re.search(r"CHAPTER I\.", text)
    if not start:
        raise SystemExit("CHAPTER I not found")
    text = text[start.start() :]
    end = re.search(r"\*\*\*\s*END OF (THE |THIS )?PROJECT GUTENBERG", text, re.I)
    if end:
        text = text[: end.start()]

    parts = re.split(r"\n(?=CHAPTER [IVXLC]+\.)", text)
    chapters: list[dict] = []
    for i, part in enumerate(parts):
        if i >= NUM_CHAPTERS:
            break
        lines = part.strip().splitlines()
        body_lines: list[str] = []
        skipped = 0
        for line in lines:
            if skipped == 0 and line.startswith("CHAPTER "):
                skipped = 1
                continue
            if skipped == 1:
                # title line
                skipped = 2
                continue
            body_lines.append(line)

        body = "\n".join(body_lines)
        paras_raw = re.split(r"\n\s*\n", body)
        paragraphs = []
        for pr in paras_raw:
            pr = re.sub(r"\n", " ", pr)
            pr = re.sub(r"\s+", " ", pr).strip()
            if not pr or pr.startswith("[Illustration"):
                continue
            sents = split_sentences(pr)
            if sents:
                paragraphs.append({"sentences": [{"text": s} for s in sents]})
        if not paragraphs:
            continue
        chapters.append(
            {
                "index": len(chapters),
                "title": CHAPTER_TITLES[len(chapters)],
                "paragraphs": paragraphs,
            }
        )
    return chapters


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"missing {SRC} — download Gutenberg 11-0.txt first")
    raw = clean_text(SRC.read_text(encoding="utf-8", errors="replace"))
    chapters = parse_chapters(raw)
    print(f"parsed {len(chapters)} chapters")
    for c in chapters:
        n = sum(len(p["sentences"]) for p in c["paragraphs"])
        chars = sum(len(s["text"]) for p in c["paragraphs"] for s in p["sentences"])
        print(f"  [{c['index']}] {c['title']}: {n} sents, {chars} chars")

    book = {
        "id": "alice",
        "title": "Alice's Adventures in Wonderland",
        "chapters": chapters,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "text.json").write_text(
        json.dumps(book, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    manifest = {
        "id": "alice",
        "title": "Alice's Adventures in Wonderland",
        "language": "en",
        "text": {"url": "text.json", "bytes": 0},
        "chapters": [
            {
                "index": c["index"],
                "title": c["title"],
                "duration": 0,
                "audio": {"url": f"audio/ch{c['index']:03d}.mp3", "bytes": 0},
                "timings": {"url": f"timings/ch{c['index']:03d}.json", "bytes": 0},
            }
            for c in chapters
        ],
    }
    (OUT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("wrote text.json + manifest.json")


if __name__ == "__main__":
    main()
