"""YouTube channel profile + banner, Lumina RSVP brand."""
from __future__ import annotations

import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

from lumina import (
    PALETTES,
    _draw_tracked,
    _hex,
    _text_width,
    display_font,
    mono_font,
    orp_index,
)

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "out" / "rsvp-video" / "channel"

# YouTube: 2560x1440 upload. Always-visible strip is 1546x423 centered.
BANNER = (2560, 1440)
SAFE = (1546, 423)
PROFILE = (800, 800)


def _font(name: str, size: int):
    for p in (
        Path(rf"C:\Windows\Fonts\{name}"),
        Path(rf"C:\Windows\Fonts\{name.lower()}"),
    ):
        if p.is_file():
            try:
                from PIL import ImageFont

                return ImageFont.truetype(str(p), size=size)
            except OSError:
                continue
    return display_font(size)


def _grain(img: Image.Image, amount: int = 18) -> Image.Image:
    w, h = img.size
    rng = random.Random(11)
    noise = Image.new("L", (w, h))
    noise.putdata([rng.randint(0, 255) for _ in range(w * h)])
    noise = noise.filter(ImageFilter.GaussianBlur(0.6))
    overlay = Image.merge("RGB", (noise, noise, noise))
    return Image.blend(img, overlay, amount / 255.0)


def _wash(img: Image.Image) -> Image.Image:
    """Slight center lift so type sits on a living field, not a flat fill."""
    w, h = img.size
    wash = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(wash)
    d.ellipse((-w * 0.1, -h * 0.2, w * 1.1, h * 1.05), fill=70)
    wash = wash.filter(ImageFilter.GaussianBlur(min(w, h) // 6))
    tint = Image.new("RGB", (w, h), (36, 32, 27))
    return Image.composite(tint, img, wash)


def profile() -> Image.Image:
    pal = PALETTES["dark"]
    bg, fg, muted, accent = _hex(pal["bg"]), _hex(pal["fg"]), _hex(pal["muted"]), _hex(pal["accent"])
    s = PROFILE[0]
    img = Image.new("RGB", PROFILE, bg)
    img = _wash(img)
    draw = ImageDraw.Draw(img)

    # Keep everything inside the circular crop (~70% of square).
    word = "RSVP"
    font = _font("georgiab.ttf", 236)
    tracking = -6
    orp = orp_index(len(word))
    tw = _text_width(draw, word, font, tracking)
    bbox = draw.textbbox((0, 0), "Hg", font=font)
    th = bbox[3] - bbox[1]
    x = (s - tw) / 2
    y = s * 0.52 - th / 2
    _draw_tracked(draw, x, y, word, font, fg, tracking, orp, accent)

    mark = mono_font(22)
    label = "LUMINA"
    lw = _text_width(draw, label, mark, 10)
    cx = (s - lw) / 2
    cy = y - 56
    _draw_tracked(draw, cx, cy, label, mark, muted, 10, None, accent)

    img = _grain(img, 12)
    img = ImageEnhance.Contrast(img).enhance(1.04)
    return img


def banner() -> Image.Image:
    pal = PALETTES["dark"]
    bg, fg, muted, border, accent = (
        _hex(pal["bg"]),
        _hex(pal["fg"]),
        _hex(pal["muted"]),
        _hex(pal["border"]),
        _hex(pal["accent"]),
    )
    w, h = BANNER
    img = Image.new("RGB", BANNER, bg)
    img = _wash(img)
    draw = ImageDraw.Draw(img)

    sx = (w - SAFE[0]) / 2
    sy = (h - SAFE[1]) / 2

    # TV-only: oversized ghost word so the full 16:9 isn't empty.
    ghost_f = _font("georgia.ttf", 520)
    ghost = "RSVP"
    gw = _text_width(draw, ghost, ghost_f, -8)
    draw.text(
        ((w - gw) / 2, h * 0.72),
        ghost,
        font=ghost_f,
        fill=(45, 40, 34),
    )

    # Safe-zone composition: brand + one sentence + one flashed word.
    brand_f = _font("georgia.ttf", 72)
    rsvp_f = _font("georgiab.ttf", 72)
    tag_f = _font("georgia.ttf", 36)
    word_f = _font("georgiab.ttf", 168)

    bx, by = sx + 8, sy + 78
    draw.text((bx, by), "Lumina ", font=brand_f, fill=fg)
    lumina_w = draw.textbbox((0, 0), "Lumina ", font=brand_f)[2]
    draw.text((bx + lumina_w, by), "RSVP", font=rsvp_f, fill=accent)

    tag = "Classic books. One word at a time."
    draw.text((bx, by + 96), tag, font=tag_f, fill=muted)

    bar_y = sy + 48
    bar_h = 2
    draw.rectangle([sx + 8, bar_y, sx + SAFE[0] - 8, bar_y + bar_h], fill=border)
    draw.rectangle([sx + 8, bar_y, sx + 8 + int((SAFE[0] - 16) * 0.18), bar_y + bar_h], fill=fg)

    flash = "Alice"
    tracking = -4
    orp = orp_index(len(flash))
    tw = _text_width(draw, flash, word_f, tracking)
    fx = sx + SAFE[0] - tw - 24
    fy = sy + 118
    _draw_tracked(draw, fx, fy, flash, word_f, fg, tracking, orp, accent)

    img = _grain(img, 10)
    return img


def banner_preview(src: Image.Image) -> Image.Image:
    """Guides for the 1546×423 always-visible strip. Do not upload this one."""
    img = src.copy()
    draw = ImageDraw.Draw(img, "RGBA")
    w, h = BANNER
    sx, sy = (w - SAFE[0]) / 2, (h - SAFE[1]) / 2
    draw.rectangle([sx, sy, sx + SAFE[0], sy + SAFE[1]], outline=(212, 106, 82, 180), width=3)
    note = mono_font(22)
    draw.text((sx, sy - 32), "SAFE 1546x423  (all devices)", font=note, fill=_hex(PALETTES["dark"]["accent"]))
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    p = profile()
    b = banner()
    p.save(OUT / "profile.png", "PNG")
    b.save(OUT / "banner.png", "PNG")
    banner_preview(b).save(OUT / "banner-safe-preview.png", "PNG")
    print(f"wrote {OUT / 'profile.png'}")
    print(f"wrote {OUT / 'banner.png'}")
    print(f"wrote {OUT / 'banner-safe-preview.png'}  (guides only)")


if __name__ == "__main__":
    main()
