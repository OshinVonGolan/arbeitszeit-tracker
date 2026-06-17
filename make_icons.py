#!/usr/bin/env python3
"""Erzeugt die App-Icons (Stoppuhr-Glyph auf Indigo-Verlauf)."""
from PIL import Image, ImageDraw
import math

ACCENT_TOP = (99, 102, 241)    # indigo-500
ACCENT_BOT = (67, 56, 202)     # indigo-700
WHITE = (255, 255, 255)


def gradient(size, top, bot):
    img = Image.new("RGB", (size, size), top)
    px = img.load()
    for y in range(size):
        t = y / (size - 1)
        r = round(top[0] + (bot[0] - top[0]) * t)
        g = round(top[1] + (bot[1] - top[1]) * t)
        b = round(top[2] + (bot[2] - top[2]) * t)
        for x in range(size):
            px[x, y] = (r, g, b)
    return img


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def draw_stopwatch(img, cx, cy, r):
    d = ImageDraw.Draw(img)
    lw = int(max(6, r // 9))
    # Krone / Knopf oben
    d.rounded_rectangle([cx - r * 0.18, cy - r * 1.42, cx + r * 0.18, cy - r * 1.12],
                        radius=r * 0.08, fill=WHITE)
    d.line([cx - r * 0.55, cy - r * 1.30, cx - r * 0.30, cy - r * 1.05], fill=WHITE, width=lw)
    d.line([cx + r * 0.55, cy - r * 1.30, cx + r * 0.30, cy - r * 1.05], fill=WHITE, width=lw)
    # Gehäuse (Ring)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=WHITE, width=lw)
    # Zeiger
    d.line([cx, cy, cx, cy - r * 0.62], fill=WHITE, width=lw)
    ang = math.radians(48)
    d.line([cx, cy, cx + r * 0.45 * math.sin(ang), cy - r * 0.45 * math.cos(ang)],
           fill=WHITE, width=lw)
    # Mittelpunkt
    d.ellipse([cx - lw * 0.9, cy - lw * 0.9, cx + lw * 0.9, cy + lw * 0.9], fill=WHITE)


def make(size, maskable, name):
    img = gradient(size, ACCENT_TOP, ACCENT_BOT).convert("RGBA")
    # Bei "any"-Icons leicht abgerundete Ecken; maskable bleibt voll (Plattform maskiert).
    if not maskable:
        mask = rounded_mask(size, int(size * 0.22))
        img.putalpha(mask)
    scale = 0.62 if maskable else 0.78   # maskable: Glyph im Safe-Zone-Bereich
    r = size * 0.5 * scale * 0.62
    draw_stopwatch(img, size / 2, size / 2 + size * 0.04, r)
    img.save(name)
    print("wrote", name)


make(192, False, "icon-192.png")
make(512, False, "icon-512.png")
make(512, True, "icon-maskable-512.png")
