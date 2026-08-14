"""Render RSVP chapter videos with Pillow + ffmpeg."""
from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Callable

from books import Chapter, load_timing_stream
from lumina import PRESETS, draw_rsvp_frame, draw_title_card

ProgressFn = Callable[[str, float], None]

TITLE_SEC = 2.0
END_HOLD_SEC = 1.0
MIN_CLIP = 0.04
FPS = 30
TITLE_FRAMES = round(TITLE_SEC * FPS)
HOLD_FRAMES = round(END_HOLD_SEC * FPS)


def slug(s: str) -> str:
    keep = []
    for ch in s:
        if ch.isalnum() or ch in "._-":
            keep.append(ch)
        elif ch in " \t":
            keep.append("_")
    out = "".join(keep).strip("_")
    return out[:80] or "chapter"


def ffmpeg_bin() -> str:
    exe = shutil.which("ffmpeg")
    if not exe:
        raise RuntimeError("ffmpeg not found on PATH")
    return exe


def audio_duration(path: Path) -> float:
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


def word_spans(
    tokens: list[str],
    starts: list[float],
    audio_dur: float,
    lead: float,
) -> list[tuple[str, float]]:
    """(word, duration) covering [0, audio_dur]."""
    n = len(tokens)
    if n == 0:
        return [(" ", max(MIN_CLIP, audio_dur))]
    bounds = [max(0.0, min(audio_dur, s - lead)) for s in starts]
    bounds.append(audio_dur)
    for i in range(1, len(bounds)):
        if bounds[i] < bounds[i - 1]:
            bounds[i] = bounds[i - 1]

    clips: list[tuple[str, float]] = []
    if bounds[0] > 0:
        clips.append((tokens[0], bounds[0]))
    for i in range(n):
        dur = bounds[i + 1] - bounds[i]
        if dur <= 0:
            continue
        clips.append((tokens[i], dur))
    total = sum(d for _, d in clips)
    gap = audio_dur - total
    if clips and abs(gap) > 0.01:
        clips[-1] = (clips[-1][0], max(MIN_CLIP, clips[-1][1] + gap))
    elif not clips:
        clips.append((tokens[0], max(MIN_CLIP, audio_dur)))
    return clips


def _frame_counts(durations: list[float], total_sec: float, fps: int = FPS) -> list[int]:
    """Integer frames per clip from absolute clock so rounding cannot accumulate."""
    target = max(1, round(total_sec * fps))
    if not durations:
        return [target]
    acc = 0.0
    ends: list[int] = []
    prev = 0
    for i, d in enumerate(durations):
        acc += d
        ef = round(acc * fps)
        if i == len(durations) - 1:
            ef = target
        if ef <= prev:
            ef = prev + 1
        ends.append(ef)
        prev = ef
    extra = prev - target
    i = len(ends) - 1
    while extra > 0 and i >= 0:
        prev_end = ends[i - 1] if i else 0
        room = ends[i] - prev_end - 1
        take = min(room, extra)
        if take > 0:
            for j in range(i, len(ends)):
                ends[j] -= take
            extra -= take
        i -= 1
    counts: list[int] = []
    prev = 0
    for ef in ends:
        counts.append(ef - prev)
        prev = ef
    return counts


def _write_jpeg_frames(proc_stdin, jpeg: bytes, n: int) -> None:
    for _ in range(n):
        proc_stdin.write(jpeg)


def output_name(book_title: str, chapter: Chapter, preset: str) -> str:
    tag = "1080p" if preset == "1080p" else "shorts"
    chap = slug(chapter.title.replace("CHAPTER ", ""))
    book = slug(book_title)
    return f"{book}_ch{chapter.index:02d}_{chap}_{tag}.mp4"


def render_chapter(
    book_title: str,
    chapter: Chapter,
    out_path: Path,
    preset: str = "1080p",
    theme: str = "light",
    lead: float = 0.2,
    progress: ProgressFn | None = None,
) -> Path:
    if preset not in PRESETS:
        raise ValueError(f"unknown preset {preset}")
    ff = ffmpeg_bin()
    tokens, starts, _last = load_timing_stream(chapter.timings)
    if not chapter.audio.is_file():
        raise FileNotFoundError(chapter.audio)
    audio_dur = audio_duration(chapter.audio)
    spans = word_spans(tokens, starts, audio_dur, lead)
    n_words = len(spans)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    def note(msg: str, frac: float) -> None:
        if progress:
            progress(msg, frac)

    rsvp_frames = _frame_counts([d for _, d in spans], audio_dur)
    total_frames = TITLE_FRAMES + sum(rsvp_frames) + HOLD_FRAMES
    with tempfile.TemporaryDirectory(prefix="rsvp-vid-") as td:
        tmp = Path(td)

        note("Title card…", 0.01)
        title = draw_title_card(book_title, chapter.title, preset, theme)
        title_path = tmp / "title.jpg"
        title.save(title_path, "JPEG", quality=94, optimize=True)

        jobs: list[tuple[Path, int]] = [(title_path, TITLE_FRAMES)]
        last_path = title_path
        for i, (word, _dur) in enumerate(spans):
            prog = (i + 1) / max(1, n_words)
            img = draw_rsvp_frame(word, prog, chapter.title, preset, theme)
            fp = tmp / f"w{i:05d}.jpg"
            img.save(fp, "JPEG", quality=92, optimize=True)
            jobs.append((fp, rsvp_frames[i]))
            last_path = fp
            if i % 40 == 0 or i == n_words - 1:
                note(f"Frames {i + 1}/{n_words}", 0.05 + 0.7 * (i + 1) / max(1, n_words))
        jobs.append((last_path, HOLD_FRAMES))

        note("Encoding…", 0.82)
        delay_ms = int(round(TITLE_FRAMES * 1000 / FPS))
        err_path = tmp / "ffmpeg.err"
        cmd = [
            ff,
            "-y",
            "-f",
            "image2pipe",
            "-framerate",
            str(FPS),
            "-c:v",
            "mjpeg",
            "-i",
            "pipe:0",
            "-i",
            str(chapter.audio),
            "-filter_complex",
            f"[1:a]adelay={delay_ms}|{delay_ms},apad[a]",
            "-map",
            "0:v",
            "-map",
            "[a]",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-tune",
            "stillimage",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-r",
            str(FPS),
            "-fps_mode",
            "cfr",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            "-shortest",
            "-frames:v",
            str(total_frames),
            str(out_path),
        ]
        with err_path.open("wb") as errf:
            proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=errf,
                bufsize=1024 * 1024,
            )
            assert proc.stdin is not None
            try:
                for j, (fp, nfr) in enumerate(jobs):
                    _write_jpeg_frames(proc.stdin, fp.read_bytes(), nfr)
                    if j % 80 == 0:
                        note(f"Encoding {j + 1}/{len(jobs)}", 0.82 + 0.16 * (j + 1) / len(jobs))
                proc.stdin.close()
                rc = proc.wait()
            except BrokenPipeError:
                proc.kill()
                rc = proc.wait()
        if rc != 0:
            err = err_path.read_text(encoding="utf-8", errors="replace").strip()
            raise RuntimeError(err[-4000:] or f"ffmpeg failed ({rc})")
        note(f"Wrote {out_path.name}", 1.0)
    return out_path
