"""YouTube thumbnail 1280x720 — Alice Ch 1, Lumina + Tenniel (PD)."""
from __future__ import annotations

import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps

from lumina import PALETTES, _draw_tracked, _hex, _text_width, display_font, mono_font, orp_index

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "out" / "rsvp-video" / "channel"
SRC = Path(__file__).resolve().parent / "assets" / "alice-white-rabbit.jpg"
SIZE = (1280, 720)


def _font(name: str, size: int):
    for p in (Path(rf"C:\Windows\Fonts\{name}"), Path(rf"C:\Windows\Fonts\{name.lower()}")):
        if p.is_file():
            try:
                from PIL import ImageFont

                return ImageFont.truetype(str(p), size=size)
            except OSError:
                continue
    return display_font(size)


def _grain(img: Image.Image, amount: int = 14) -> Image.Image:
    w, h = img.size
    rng = random.Random(7)
    noise = Image.new("L", (w, h))
    noise.putdata([rng.randint(0, 255) for _ in range(w * h)])
    noise = noise.filter(ImageFilter.GaussianBlur(0.5))
    overlay = Image.merge("RGB", (noise, noise, noise))
    return Image.blend(img, overlay, amount / 255.0)


def engrave_on_dark(src: Image.Image, bg: tuple[int, int, int], ink: tuple[int, int, int]) -> Image.Image:
    g = ImageOps.invert(src.convert("L"))
    g = ImageEnhance.Contrast(g).enhance(1.35)
    g = ImageEnhance.Brightness(g).enhance(1.08)
    cream = Image.new("RGB", src.size, ink)
    base = Image.new("RGB", src.size, bg)
    return Image.composite(cream, base, g)


def rabbit_panel(h: int, bg, ink) -> Image.Image:
    raw = Image.open(SRC).convert("RGB")
    art = engrave_on_dark(raw, bg, ink)
    # Scale tall; crop into a 720-tall strip, keep the figure.
    scale = (h * 1.32) / art.height
    art = art.resize((int(art.width * scale), int(art.height * scale)), Image.Resampling.LANCZOS)
    top = int((art.height - h) * 0.08)
    art = art.crop((0, top, art.width, top + h))
    return art


def thumbnail() -> Image.Image:
    pal = PALETTES["dark"]
    bg, fg, muted, accent = _hex(pal["bg"]), _hex(pal["fg"]), _hex(pal["muted"]), _hex(pal["accent"])
    w, h = SIZE
    img = Image.new("RGB", SIZE, bg)

    rabbit = rabbit_panel(h, bg, fg)
    # Sit on the right, facing the type.
    rx = w - rabbit.width + 70
    img.paste(rabbit, (rx, 0))

    # Soft dark veil so type never fights hatching.
    veil = Image.new("L", SIZE, 0)
    vd = ImageDraw.Draw(veil)
    for x in range(0, int(w * 0.62)):
        t = x / (w * 0.62)
        vd.line([(x, 0), (x, h)], fill=int(255 * (1 - t) ** 1.35))
    dark = Image.new("RGB", SIZE, bg)
    img = Image.composite(dark, img, veil)

    draw = ImageDraw.Draw(img)
    pad = 64

    meta = mono_font(22)
    _draw_tracked(draw, pad, 52, "CH  1", meta, muted, 6, None, accent)
    lumina_w = _text_width(draw, "CH  1", meta, 6)
    draw.text((pad + lumina_w + 18, 50), "·", font=meta, fill=accent)
    _draw_tracked(draw, pad + lumina_w + 36, 52, "RSVP", meta, accent, 4, None, accent)

    hero = _font("georgiab.ttf", 196)
    word = "ALICE"
    tracking = -5
    orp = orp_index(len(word))
    _draw_tracked(draw, pad, 168, word, hero, fg, tracking, orp, accent)

    sub = _font("georgia.ttf", 42)
    draw.text((pad, 392), "Down the Rabbit-Hole", font=sub, fill=muted)

    bar_y = 468
    draw.rectangle([pad, bar_y, pad + 220, bar_y + 3], fill=accent)

    img = _grain(img, 11)
    img = ImageEnhance.Contrast(img).enhance(1.06)
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    im = thumbnail()
    jpg = OUT / "thumb-ch00.jpg"
    im.save(jpg, "JPEG", quality=92, optimize=True, subsampling=1)
    im.save(OUT / "thumb-ch00.png", "PNG")
    print(f"wrote {jpg}  ({jpg.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
