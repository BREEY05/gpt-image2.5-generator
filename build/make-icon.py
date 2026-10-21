#!/usr/bin/env python3
"""Generate build/icon.ico (multi-size) for GPT Image Studio.

Design: rounded square with a purple -> magenta diagonal gradient and a white
four-pointed "sparkle" star, matching the app's accent (#a78bfa / #6d28d9).
Requires Pillow. Run: python build/make-icon.py
"""
from __future__ import annotations

import math
import os

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SIZE = 1024
SIZES = [256, 128, 64, 48, 32, 16]

# UI accent palette: violet -> fuchsia/magenta.
TOP_LEFT = (109, 40, 217)      # #6d28d9 (light-theme accent)
BOTTOM_RIGHT = (217, 70, 239)  # #d946ef (fuchsia)


def lerp(a: int, b: int, t: float) -> int:
    return round(a + (b - a) * t)


def gradient_square(size: int) -> Image.Image:
    """Diagonal purple -> magenta gradient."""
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            px[x, y] = (
                lerp(TOP_LEFT[0], BOTTOM_RIGHT[0], t),
                lerp(TOP_LEFT[1], BOTTOM_RIGHT[1], t),
                lerp(TOP_LEFT[2], BOTTOM_RIGHT[2], t),
            )
    return img


def rounded_mask(size: int, radius_ratio: float = 0.225) -> Image.Image:
    """Antialiased rounded-square alpha mask (supersampled 4x)."""
    scale = 4
    m = Image.new("L", (size * scale, size * scale), 0)
    d = ImageDraw.Draw(m)
    r = int(size * scale * radius_ratio)
    d.rounded_rectangle(
        (0, 0, size * scale - 1, size * scale - 1), radius=r, fill=255
    )
    return m.resize((size, size), Image.LANCZOS)


def star_points(cx: float, cy: float, outer: float, waist: float = 0.16, n: int = 240):
    """Slender four-pointed sparkle: r = outer * (1 - b*|sin(2t)|^p)."""
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        r = outer * (1.0 - (1.0 - waist) * abs(math.sin(2 * t)) ** 0.85)
        pts.append((cx + r * math.cos(t), cy + r * math.sin(t)))
    return pts


def make_icon() -> Image.Image:
    # ---- background ------------------------------------------------
    bg = gradient_square(SIZE).convert("RGBA")

    # Soft top-left sheen + bottom-right depth for a tactile feel.
    sheen = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sheen)
    sd.ellipse((-SIZE * 0.25, -SIZE * 0.55, SIZE * 0.85, SIZE * 0.55),
               fill=(255, 255, 255, 34))
    bg = Image.alpha_composite(bg, sheen.filter(ImageFilter.GaussianBlur(SIZE * 0.06)))
    shade = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    shd = ImageDraw.Draw(shade)
    shd.ellipse((SIZE * 0.15, SIZE * 0.55, SIZE * 1.25, SIZE * 1.45),
                fill=(40, 0, 70, 60))
    bg = Image.alpha_composite(bg, shade.filter(ImageFilter.GaussianBlur(SIZE * 0.08)))

    # Subtle inner border ring.
    ring = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    rd = ImageDraw.Draw(ring)
    inset = int(SIZE * 0.02)
    rd.rounded_rectangle(
        (inset, inset, SIZE - inset - 1, SIZE - inset - 1),
        radius=int(SIZE * 0.21), outline=(255, 255, 255, 46), width=max(2, SIZE // 180),
    )
    bg = Image.alpha_composite(bg, ring)

    # ---- white four-pointed star ----------------------------------
    star_layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(star_layer)
    cx, cy = SIZE * 0.5, SIZE * 0.5
    outer = SIZE * 0.375
    pts = star_points(cx, cy, outer, waist=0.165)
    # Soft drop shadow under the star.
    shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    sh = ImageDraw.Draw(shadow)
    sh.polygon([(x + SIZE * 0.012, y + SIZE * 0.018) for x, y in pts], fill=(30, 0, 50, 90))
    bg = Image.alpha_composite(bg, shadow.filter(ImageFilter.GaussianBlur(SIZE * 0.012)))

    d.polygon(pts, fill=(255, 255, 255, 255))
    # Small companion sparkle, echoing the app's lucide "Sparkles" icon.
    sx, sy = SIZE * 0.775, SIZE * 0.235
    small = star_points(sx, sy, SIZE * 0.098, waist=0.19, n=160)
    d.polygon(small, fill=(255, 255, 255, 235))

    bg = Image.alpha_composite(bg, star_layer)
    bg.putalpha(rounded_mask(SIZE))
    return bg


def main() -> None:
    icon = make_icon()
    ico_path = os.path.join(HERE, "icon.ico")
    png_path = os.path.join(HERE, "icon.png")
    icon.save(png_path, "PNG")
    icon.save(ico_path, "ICO", sizes=[(s, s) for s in SIZES], bitmap_format="png")
    # Sanity: report embedded sizes from the generated file.
    check = Image.open(ico_path)
    print(f"wrote {ico_path} ({os.path.getsize(ico_path)} bytes)")
    print(f"wrote {png_path} ({os.path.getsize(png_path)} bytes)")
    print("ico sizes:", sorted(check.ico.sizes()) if hasattr(check, "ico") else "n/a")
    for s in SIZES:
        check.size = (s, s)
        try:
            check.load()
        except Exception as exc:  # noqa: BLE001
            print(f"  [{s}] load failed: {exc}")


if __name__ == "__main__":
    main()