"""Lumina still-frame layout for 16:9 and 9:16 RSVP videos."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

PALETTES = {
    "light": {
        "bg": "#F7F6F3",
        "fg": "#2A2218",
        "muted": "#7A7168",
        "border": "#E4E0D8",
        "accent": "#B54A32",
    },
    "dark": {
        "bg": "#1C1814",
        "fg": "#F4F1EA",
        "muted": "#A39A90",
        "border": "#3D362E",
        "accent": "#D46A52",
    },
}

PRESETS = {
    "1080p": (1920, 1080),
    "shorts": (1080, 1920),
}

_FONT_CANDIDATES = [
    Path(r"C:\Windows\Fonts\georgia.ttf"),
    Path(r"C:\Windows\Fonts\Georgia.ttf"),
    Path(r"C:\Windows\Fonts\times.ttf"),
    Path("/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf"),
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"),
    Path("/System/Library/Fonts/Supplemental/Georgia.ttf"),
]

_MONO_CANDIDATES = [
    Path(r"C:\Windows\Fonts\consola.ttf"),
    Path(r"C:\Windows\Fonts\cour.ttf"),
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"),
    Path("/System/Library/Fonts/Menlo.ttc"),
]


def _first_font(paths: list[Path], size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for p in paths:
        if p.is_file():
            try:
                return ImageFont.truetype(str(p), size=size)
            except OSError:
                continue
    return ImageFont.load_default()


def display_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    return _first_font(_FONT_CANDIDATES, size)


def mono_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    return _first_font(_MONO_CANDIDATES, size)


def rsvp_size(text_len: int, width: int, height: int) -> float:
    ref = min(width, height)
    if text_len > 28:
        lo, vw, hi = 0.035 * ref, 0.045 * width, 0.065 * ref
    elif text_len > 16:
        lo, vw, hi = 0.05 * ref, 0.07 * width, 0.095 * ref
    else:
        lo, vw, hi = 0.075 * ref, 0.11 * width, 0.155 * ref
    return max(lo, min(hi, vw))


def orp_index(length: int) -> int:
    if length <= 0:
        return 0
    return max(0, min(length - 1, int(length * 0.4)))


def _hex(c: str) -> tuple[int, int, int]:
    h = c.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _text_width(draw: ImageDraw.ImageDraw, text: str, font, tracking: float) -> float:
    if not text:
        return 0.0
    w = 0.0
    for i, ch in enumerate(text):
        box = draw.textbbox((0, 0), ch, font=font)
        w += box[2] - box[0]
        if i < len(text) - 1:
            w += tracking
    return w


def _draw_tracked(
    draw: ImageDraw.ImageDraw,
    x: float,
    y: float,
    text: str,
    font,
    fill: tuple[int, int, int],
    tracking: float,
    orp_i: int | None,
    accent: tuple[int, int, int],
) -> None:
    cx = x
    for i, ch in enumerate(text):
        color = accent if orp_i is not None and i == orp_i else fill
        draw.text((cx, y), ch, font=font, fill=color)
        box = draw.textbbox((0, 0), ch, font=font)
        cx += (box[2] - box[0]) + tracking


def draw_title_card(
    book_title: str,
    chapter_title: str,
    preset: str,
    theme: str,
) -> Image.Image:
    w, h = PRESETS[preset]
    pal = PALETTES[theme]
    bg, fg, muted, accent = _hex(pal["bg"]), _hex(pal["fg"]), _hex(pal["muted"]), _hex(pal["accent"])
    img = Image.new("RGB", (w, h), bg)
    draw = ImageDraw.Draw(img)
    brand = display_font(max(28, h // 28))
    title_f = display_font(max(42, h // 16))
    chap_f = display_font(max(28, h // 28))
    cx, cy = w / 2, h / 2
    brand_w = draw.textbbox((0, 0), "Lumina RSVP", font=brand)[2]
    draw.text((cx - brand_w / 2, cy - h * 0.18), "Lumina ", font=brand, fill=fg)
    lumina_w = draw.textbbox((0, 0), "Lumina ", font=brand)[2]
    draw.text((cx - brand_w / 2 + lumina_w, cy - h * 0.18), "RSVP", font=brand, fill=accent)
    tw = draw.textbbox((0, 0), book_title, font=title_f)[2]
    draw.text((cx - tw / 2, cy - h * 0.04), book_title, font=title_f, fill=fg)
    cw = draw.textbbox((0, 0), chapter_title, font=chap_f)[2]
    draw.text((cx - cw / 2, cy + h * 0.08), chapter_title, font=chap_f, fill=muted)
    return img


def draw_rsvp_frame(
    word: str,
    progress: float,
    chapter_title: str,
    preset: str,
    theme: str,
) -> Image.Image:
    w, h = PRESETS[preset]
    pal = PALETTES[theme]
    bg, fg, muted, border, accent = (
        _hex(pal["bg"]),
        _hex(pal["fg"]),
        _hex(pal["muted"]),
        _hex(pal["border"]),
        _hex(pal["accent"]),
    )
    img = Image.new("RGB", (w, h), bg)
    draw = ImageDraw.Draw(img)

    pad = int(w * 0.04 if preset == "1080p" else w * 0.07)
    brand_f = display_font(max(22, h // 36))
    meta_f = mono_font(max(16, h // 54))

    draw.text((pad, pad), "Lumina ", font=brand_f, fill=fg)
    lw = draw.textbbox((0, 0), "Lumina ", font=brand_f)[2]
    draw.text((pad + lw, pad), "RSVP", font=brand_f, fill=accent)

    chap = chapter_title.replace("CHAPTER ", "")
    cw = draw.textbbox((0, 0), chap, font=meta_f)[2]
    draw.text((w - pad - cw, pad + 6), chap.upper(), font=meta_f, fill=muted)

    bar_y = pad + int(h * 0.055)
    bar_h = max(2, h // 540)
    draw.rectangle([pad, bar_y, w - pad, bar_y + bar_h], fill=border)
    fill_w = int((w - 2 * pad) * max(0.0, min(1.0, progress)))
    if fill_w > 0:
        draw.rectangle([pad, bar_y, pad + fill_w, bar_y + bar_h], fill=fg)

    text = word or " "
    size = int(rsvp_size(len(text), w, h))
    font = display_font(size)
    tracking = size * -0.02
    orp_i = orp_index(len(text))
    total_w = _text_width(draw, text, font, tracking)
    bbox = draw.textbbox((0, 0), "Hg", font=font)
    text_h = bbox[3] - bbox[1]
    x = (w - total_w) / 2
    y = h * 0.48 - text_h / 2
    _draw_tracked(draw, x, y, text, font, fg, tracking, orp_i, accent)
    return img
