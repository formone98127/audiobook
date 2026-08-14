"""Scan public/books and load manifest / timings / audio paths."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
BOOKS_DIR = REPO / "public" / "books"


@dataclass
class Chapter:
    index: int
    title: str
    duration: float
    audio: Path
    timings: Path


@dataclass
class Book:
    id: str
    title: str
    root: Path
    chapters: list[Chapter]


def scan_books(root: Path | None = None) -> list[Book]:
    base = root or BOOKS_DIR
    out: list[Book] = []
    if not base.is_dir():
        return out
    for d in sorted(base.iterdir()):
        man_path = d / "manifest.json"
        if not man_path.is_file():
            continue
        try:
            out.append(load_book(d))
        except (OSError, json.JSONDecodeError, KeyError):
            continue
    return out


def load_book(book_dir: Path) -> Book:
    man = json.loads((book_dir / "manifest.json").read_text(encoding="utf-8"))
    chapters: list[Chapter] = []
    for ch in man["chapters"]:
        chapters.append(
            Chapter(
                index=int(ch["index"]),
                title=str(ch["title"]),
                duration=float(ch.get("duration") or 0),
                audio=book_dir / ch["audio"]["url"],
                timings=book_dir / ch["timings"]["url"],
            )
        )
    return Book(
        id=str(man.get("id") or book_dir.name),
        title=str(man.get("title") or book_dir.name),
        root=book_dir,
        chapters=chapters,
    )


def load_timing_stream(path: Path) -> tuple[list[str], list[float], float]:
    """Return (tokens, start_times, last_end)."""
    data = json.loads(path.read_text(encoding="utf-8"))
    words = data.get("words") or []
    tokens = data.get("tokens")
    starts = [float(row[2]) for row in words]
    ends = [float(row[3]) for row in words]
    if not tokens or len(tokens) != len(starts):
        tokens = [f"#{i}" for i in range(len(starts))]
    last_end = ends[-1] if ends else 0.0
    return tokens, starts, last_end
