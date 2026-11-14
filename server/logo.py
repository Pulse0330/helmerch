# -*- coding: utf-8 -*-
"""Хэлмэрчийн лого: цэнхэр дэвсгэр дээр ярианы хөөс, дотор нь монгол өлзий хээ.
Tray дүрс, .ico, суулгагчийн зураг бүгд эндээс зурагдана (PIL)."""
import math
import os

BLUE_TOP = (21, 101, 192)
BLUE_BOT = (13, 44, 107)
RED = (229, 57, 53)

KNOT_COLORS = {"ready": RED, "idle": RED, "loading": (255, 179, 0), "error": (150, 156, 168)}


def _rounded_gradient(size, radius):
    from PIL import Image, ImageDraw
    grad = Image.new("RGBA", (size, size))
    d = ImageDraw.Draw(grad)
    for y in range(size):
        k = y / max(1, size - 1)
        c = tuple(int(a * (1 - k) + b * k) for a, b in zip(BLUE_TOP, BLUE_BOT))
        d.line((0, y, size, y), fill=c + (255,))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(grad, (0, 0), mask)
    return out


def draw_logo(size=256, knot=RED, background=True):
    """Логог size×size RGBA зураг болгон буцаана (4 дахин том зураад жижигрүүлнэ)."""
    from PIL import Image, ImageDraw
    S = size * 4
    u = S / 64.0  # 64 нэгжийн сүлжээ (SVG-тэй ижил)
    img = _rounded_gradient(S, int(15 * u)) if background else Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # ярианы хөөс
    d.rounded_rectangle((6 * u, 12 * u, 58 * u, 46 * u), radius=int(6 * u), fill=(255, 255, 255, 255))
    d.polygon([(20 * u, 45 * u), (30 * u, 45 * u), (20 * u, 54 * u)], fill=(255, 255, 255, 255))
    # өлзий хээ (төв 32,29; 0.78 хэмжээ)
    cx, cy, k = 32 * u, 29 * u, 0.78 * u
    w = max(1, int(3 * k))
    P = lambda x, y: (cx + x * k, cy + y * k)
    d.line([P(0, -11), P(11, 0), P(0, 11), P(-11, 0), P(0, -11)], fill=knot, width=w, joint="curve")
    d.line([P(-5.5, -5.5), P(5.5, 5.5)], fill=knot, width=w)
    d.line([P(5.5, -5.5), P(-5.5, 5.5)], fill=knot, width=w)
    r = 3.6 * k
    for ox, oy in ((0, -13.5), (13.5, 0), (0, 13.5), (-13.5, 0)):
        x, y = P(ox, oy)
        d.ellipse((x - r, y - r, x + r, y + r), outline=knot, width=w)
    return img.resize((size, size), Image.LANCZOS)


def icon_image(state, size):
    return draw_logo(size, KNOT_COLORS.get(state, RED))


def save_ico(path):
    draw_logo(256).save(path, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])


if __name__ == "__main__":
    draw_logo(512).save("logo_preview.png")
