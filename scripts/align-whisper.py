"""Align Alice timings to the final MP3s via Whisper word clocks.

Match book tokens to Whisper words (DTW). Do not stretch by index — that
maps unrelated Whisper timestamps onto the book and invents multi-second
pauses the MP3 does not have. Unmatched book tokens interpolate between
neighboring matches. Real MP3 silences are left as holds.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

from faster_whisper import WhisperModel

ROOT = Path(__file__).resolve().parents[1]
BOOKS = ROOT / "public" / "books"

PUNCT_ONLY = re.compile(r"^[.,!?;:'\"“”‘’\-—–()[\]{}<>/\\@#$%^&*_+=|~`]+$")
KEEP_ALNUM = re.compile(r"[^a-z0-9]+")

# Pairing costs (lower = better). Skip Whisper extras cheaper than dropping book words.
COST_SKIP_HEARD = 0.45
COST_SKIP_BOOK = 0.7
COST_MISMATCH = 1.35
MIN_CLIP = 0.04
JUNK_HEARD = frozenset({"asterisk", "inaudible", "music", "blank", "unknown", "subtitle"})
CACHE = ROOT / "scripts" / ".cache" / "whisper-alice"


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


def silence_ranges(path: Path, min_dur: float = 0.45) -> list[tuple[float, float]]:
    proc = subprocess.run(
        [
            "ffmpeg",
            "-i",
            str(path),
            "-af",
            f"silencedetect=noise=-35dB:d={min_dur}",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
    )
    ranges: list[tuple[float, float]] = []
    start: float | None = None
    for line in (proc.stderr or "").splitlines():
        if "silence_start:" in line:
            try:
                start = float(line.rsplit("silence_start:", 1)[1].split()[0])
            except ValueError:
                start = None
        elif "silence_end:" in line and start is not None:
            try:
                end = float(line.rsplit("silence_end:", 1)[1].split()[0])
                ranges.append((start, end))
            except ValueError:
                pass
            start = None
    return ranges


def covered_by_silence(t0: float, t1: float, silences: list[tuple[float, float]]) -> bool:
    span = t1 - t0
    if span <= 0.01:
        return False
    covered = 0.0
    for a, b in silences:
        lo = max(t0, a)
        hi = min(t1, b)
        if hi > lo:
            covered += hi - lo
    return covered >= 0.45 * span


def norm_token(tok: str) -> str:
    t = tok.lower().replace("\u2019", "'").replace("\u2018", "'")
    t = t.replace("'", "")
    return KEEP_ALNUM.sub("", t)


def edit_distance(a: str, b: str, limit: int = 2) -> int:
    if a == b:
        return 0
    if abs(len(a) - len(b)) > limit:
        return limit + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        best = i
        for j, cb in enumerate(b, 1):
            ins = cur[j - 1] + 1
            delete = prev[j] + 1
            sub = prev[j - 1] + (ca != cb)
            v = min(ins, delete, sub)
            cur.append(v)
            if v < best:
                best = v
        if best > limit:
            return limit + 1
        prev = cur
    return prev[-1]


def pair_cost(book: str, heard: str) -> float:
    if not book or not heard:
        return COST_MISMATCH
    if book == heard:
        return 0.0
    if book == heard + "s" or heard == book + "s":
        return 0.12
    if book in heard or heard in book:
        if min(len(book), len(heard)) >= 3:
            return 0.2
    d = edit_distance(book, heard, 2)
    if d == 1:
        return 0.28
    if d == 2 and min(len(book), len(heard)) >= 5:
        return 0.5
    return COST_MISMATCH


def clean_heard(heard: list[dict]) -> list[dict]:
    out = []
    for h in heard:
        n = h.get("norm") or norm_token(h.get("text") or "")
        if not n or n in JUNK_HEARD or "asterisk" in n:
            continue
        h = dict(h)
        h["norm"] = n
        out.append(h)
    return out


def whisper_words(model: WhisperModel | None, audio_path: Path, cache_path: Path | None = None) -> list[dict]:
    if cache_path and cache_path.is_file() and cache_path.stat().st_mtime >= audio_path.stat().st_mtime:
        return clean_heard(json.loads(cache_path.read_text(encoding="utf-8")))
    if model is None:
        raise RuntimeError("Whisper model required when cache is missing")
    segments, _info = model.transcribe(
        str(audio_path),
        word_timestamps=True,
        language="en",
        beam_size=5,
        vad_filter=False,
        condition_on_previous_text=False,
    )
    heard: list[dict] = []
    for seg in segments:
        for w in seg.words or []:
            raw = (w.word or "").strip()
            if not raw or PUNCT_ONLY.match(raw):
                continue
            start = float(w.start)
            end = max(float(w.end), start + MIN_CLIP)
            heard.append({"start": start, "end": end, "text": raw, "norm": norm_token(raw)})
    heard = clean_heard(heard)
    if cache_path:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(heard), encoding="utf-8")
    return heard


def align_dtw(book_norm: list[str], heard: list[dict]) -> list[int | None]:
    """Return heard-index (or None) for each book token. Monotone."""
    n = len(book_norm)
    m = len(heard)
    if n == 0:
        return []
    if m == 0:
        return [None] * n

    inf = 1e9
    dp = [[inf] * (m + 1) for _ in range(n + 1)]
    bt = [[0] * (m + 1) for _ in range(n + 1)]  # 1=diag, 2=skip heard, 3=skip book
    dp[0][0] = 0.0
    for j in range(1, m + 1):
        dp[0][j] = dp[0][j - 1] + COST_SKIP_HEARD
        bt[0][j] = 2
    for i in range(1, n + 1):
        dp[i][0] = dp[i - 1][0] + COST_SKIP_BOOK
        bt[i][0] = 3
        bn = book_norm[i - 1]
        row = dp[i]
        prev = dp[i - 1]
        for j in range(1, m + 1):
            diag = prev[j - 1] + pair_cost(bn, heard[j - 1]["norm"])
            left = row[j - 1] + COST_SKIP_HEARD
            up = prev[j] + COST_SKIP_BOOK
            if diag <= left and diag <= up:
                row[j] = diag
                bt[i][j] = 1
            elif left <= up:
                row[j] = left
                bt[i][j] = 2
            else:
                row[j] = up
                bt[i][j] = 3

    map_to: list[int | None] = [None] * n
    i, j = n, m
    while i > 0 or j > 0:
        op = bt[i][j]
        if op == 1:
            map_to[i - 1] = j - 1
            i -= 1
            j -= 1
        elif op == 2:
            j -= 1
        else:
            i -= 1
    return map_to


def interpolate_times(
    n: int,
    map_to: list[int | None],
    heard: list[dict],
    dur: float,
) -> list[dict[str, float]]:
    starts: list[float | None] = [None] * n
    for i, j in enumerate(map_to):
        if j is not None:
            starts[i] = float(heard[j]["start"])

    if n == 0:
        return []
    if starts[0] is None:
        starts[0] = float(heard[0]["start"]) if heard else 0.0
    if starts[-1] is None:
        starts[-1] = float(heard[-1]["start"]) if heard else max(0.0, dur - MIN_CLIP)

    i = 0
    while i < n:
        if starts[i] is not None:
            i += 1
            continue
        lo = i - 1
        hi = i
        while hi < n and starts[hi] is None:
            hi += 1
        t0 = float(starts[lo]) if lo >= 0 and starts[lo] is not None else 0.0
        t1 = float(starts[hi]) if hi < n and starts[hi] is not None else dur
        span = hi - lo
        for k in range(lo + 1, hi):
            starts[k] = t0 + (t1 - t0) * (k - lo) / span
        i = hi

    out_starts: list[float] = []
    prev = 0.0
    for i in range(n):
        t = max(0.0, min(dur, float(starts[i])))
        if t < prev:
            t = prev
        out_starts.append(t)
        prev = t

    spans: list[dict[str, float]] = []
    for i, t0 in enumerate(out_starts):
        t1 = out_starts[i + 1] if i + 1 < n else dur
        if t1 < t0 + MIN_CLIP:
            t1 = min(dur, t0 + MIN_CLIP)
        spans.append({"start": t0, "end": t1})
    if spans:
        spans[-1]["end"] = max(spans[-1]["end"], dur)
    return spans


def build_timings(chapter: dict, spans: list[dict[str, float]], cjk: bool) -> dict:
    sents = sentences_of(chapter)
    expected: list[tuple[int, int, str]] = []
    for si, sent in enumerate(sents):
        for wi, tok in enumerate(words_of(sent, cjk)):
            expected.append((si, wi, tok))

    words_json: list[list[float | int]] = []
    for i, (si, wi, _tok) in enumerate(expected):
        b = spans[i] if i < len(spans) else {"start": 0.0, "end": MIN_CLIP}
        words_json.append([si, wi, round(float(b["start"]), 3), round(float(b["end"]), 3)])

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


def pick_device() -> tuple[str, str]:
    try:
        import ctranslate2

        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda", "float16"
    except Exception:
        pass
    return "cpu", "int8"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--chapters", nargs="*", type=int, default=None)
    parser.add_argument("--model", default="small.en")
    args = parser.parse_args()

    book_dir = BOOKS / "alice"
    text = json.loads((book_dir / "text.json").read_text(encoding="utf-8"))
    device, compute = pick_device()
    print(f"[alice] model={args.model} device={device} compute={compute}", flush=True)
    model_holder: list[WhisperModel | None] = [None]

    def get_model() -> WhisperModel:
        if model_holder[0] is None:
            model_holder[0] = WhisperModel(args.model, device=device, compute_type=compute)
        return model_holder[0]

    chapters = text["chapters"]
    if args.chapters:
        want = set(args.chapters)
        chapters = [ch for ch in chapters if int(ch["index"]) in want]
        if not chapters:
            print("no matching chapters", file=sys.stderr)
            sys.exit(1)

    for ch in chapters:
        idx = ch["index"]
        audio_path = book_dir / "audio" / f"ch{idx:03d}.mp3"
        timing_path = book_dir / "timings" / f"ch{idx:03d}.json"
        expected: list[str] = []
        for sent in sentences_of(ch):
            expected.extend(words_of(sent, cjk=False))
        dur = duration_sec(audio_path)
        print(f"[alice] ch{idx} whisper {audio_path.name} ({len(expected)} words, {dur:.1f}s)…", flush=True)
        cache_path = CACHE / f"ch{idx:03d}.json"
        need_model = not (
            cache_path.is_file() and cache_path.stat().st_mtime >= audio_path.stat().st_mtime
        )
        heard = whisper_words(get_model() if need_model else None, audio_path, cache_path)
        silences = silence_ranges(audio_path)
        book_norm = [norm_token(t) for t in expected]
        map_to = align_dtw(book_norm, heard)
        matched = sum(1 for j in map_to if j is not None)
        spans = interpolate_times(len(expected), map_to, heard, dur)
        timings = build_timings(ch, spans, cjk=False)
        timing_path.write_text(json.dumps(timings, ensure_ascii=False), encoding="utf-8")
        starts = [sp["start"] for sp in spans]
        gaps = [starts[i + 1] - starts[i] for i in range(len(starts) - 1)]
        big = [
            (i, round(g, 2), expected[i], "sil" if covered_by_silence(starts[i], starts[i + 1], silences) else "speech")
            for i, g in enumerate(gaps)
            if g > 1.5
        ]
        last = starts[-1] if starts else 0.0
        print(
            f"[alice] ch{idx} -> heard={len(heard)} matched={matched}/{len(expected)} "
            f"last={last:.1f}s dur={dur:.1f}s gaps>1.5s={len(big)} {big[:8]}",
            flush=True,
        )


if __name__ == "__main__":
    main()
